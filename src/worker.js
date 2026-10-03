// TempMail — Cloudflare Worker
// One worker does everything:
//   email()     -> receives mail via Email Routing, parses it, stores it in D1
//   fetch()     -> serves the /api/* JSON API, falls through to static assets
//   scheduled() -> daily cleanup of old messages

import PostalMime from 'postal-mime';

const ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function retentionDays(env) {
  const n = parseInt(env.RETENTION_DAYS, 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

async function cleanup(env) {
  const cutoff = Date.now() - retentionDays(env) * 24 * 60 * 60 * 1000;
  await env.DB.prepare('DELETE FROM messages WHERE received_at < ?')
    .bind(cutoff)
    .run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function stripTags(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function randomLocalPart(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out = [];
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= 252) continue; // 252 = 36 * 7, keeps the distribution uniform
      out.push(chars[b % 36]);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

export default {
  // ---------- Incoming email (Cloudflare Email Routing catch-all) ----------
  async email(message, env, ctx) {
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const parsed = await new PostalMime().parse(raw);

      const address = String(message.to || '').toLowerCase().trim();
      if (!address) return;

      const textBody = parsed.text || '';
      const htmlBody = parsed.html || '';

      await env.DB.prepare(
        `INSERT INTO messages
           (id, address, from_addr, from_name, subject, text_body, html_body, received_at, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
        .bind(
          crypto.randomUUID(),
          address,
          (parsed.from && parsed.from.address) || message.from || '',
          (parsed.from && parsed.from.name) || '',
          parsed.subject || '(no subject)',
          textBody,
          htmlBody,
          Date.now()
        )
        .run();

      // Opportunistic cleanup so the table stays small even without cron.
      ctx.waitUntil(cleanup(env).catch(() => {}));
    } catch (err) {
      console.error('email handler failed:', err);
    }
  },

  // ---------- Daily cleanup (cron trigger from wrangler.toml) ----------
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },

  // ---------- HTTP: API + static PWA ----------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // Optional password gate for the whole API.
    if (env.APP_PASSWORD) {
      if (request.headers.get('x-app-password') !== env.APP_PASSWORD) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    try {
      // GET /api/config -> { domain }
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({ domain: env.MAIL_DOMAIN || '' });
      }

      // GET /api/inbox?address= -> latest 100 message summaries
      if (url.pathname === '/api/inbox' && request.method === 'GET') {
        const address = (url.searchParams.get('address') || '').toLowerCase().trim();
        if (!ADDRESS_RE.test(address)) return json({ error: 'invalid address' }, 400);

        const { results } = await env.DB.prepare(
          `SELECT id, from_addr, from_name, subject, text_body, html_body, received_at, is_read
             FROM messages
            WHERE address = ?
            ORDER BY received_at DESC
            LIMIT 100`
        )
          .bind(address)
          .all();

        const messages = (results || []).map((m) => {
          const plain = m.text_body || stripTags(m.html_body);
          return {
            id: m.id,
            from_addr: m.from_addr,
            from_name: m.from_name,
            subject: m.subject,
            snippet: plain.slice(0, 120),
            received_at: m.received_at,
            is_read: m.is_read,
          };
        });
        return json({ address, messages });
      }

      // GET /api/message?id=&address= -> full message, marks read
      if (url.pathname === '/api/message' && request.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        const address = (url.searchParams.get('address') || '').toLowerCase().trim();
        if (!id || !ADDRESS_RE.test(address)) return json({ error: 'invalid id or address' }, 400);

        const row = await env.DB.prepare(
          'SELECT * FROM messages WHERE id = ? AND address = ?'
        )
          .bind(id, address)
          .first();
        if (!row) return json({ error: 'not found' }, 404);

        if (!row.is_read) {
          await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?')
            .bind(id)
            .run();
          row.is_read = 1;
        }
        return json(row);
      }

      // POST /api/delete  { id, address }
      if (url.pathname === '/api/delete' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid json' }, 400);
        }
        const id = String(body.id || '');
        const address = String(body.address || '').toLowerCase().trim();
        if (!id || !ADDRESS_RE.test(address)) return json({ error: 'invalid id or address' }, 400);

        await env.DB.prepare('DELETE FROM messages WHERE id = ? AND address = ?')
          .bind(id, address)
          .run();
        return json({ ok: true });
      }

      // POST /api/random -> { address }
      // Generates a random address whose local part has NEVER been used:
      // not in used_names (created or retired) and with no stored messages.
      if (url.pathname === '/api/random' && request.method === 'POST') {
        const domain = (env.MAIL_DOMAIN || '').toLowerCase().trim();
        if (!domain) return json({ error: 'mail domain not configured' }, 500);

        for (let attempt = 0; attempt < 10; attempt++) {
          const local = randomLocalPart(12);
          const address = `${local}@${domain}`;

          const used = await env.DB.prepare(
            'SELECT local_part FROM used_names WHERE local_part = ?'
          )
            .bind(local)
            .first();
          if (used) continue;

          const mailed = await env.DB.prepare(
            'SELECT 1 AS one FROM messages WHERE address = ? LIMIT 1'
          )
            .bind(address)
            .first();
          if (mailed) continue;

          try {
            await env.DB.prepare(
              'INSERT INTO used_names (local_part, address, created_at, retired) VALUES (?, ?, ?, 0)'
            )
              .bind(local, address, Date.now())
              .run();
          } catch {
            continue; // lost a race on the primary key — try another name
          }
          return json({ address });
        }
        return json({ error: 'could not generate a unique address, please try again' }, 500);
      }

      // POST /api/address  { address } -> register a custom address.
      // A retired (previously deleted) name is refused forever with 409.
      if (url.pathname === '/api/address' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid json' }, 400);
        }
        const address = String(body.address || '').toLowerCase().trim();
        if (!ADDRESS_RE.test(address)) return json({ error: 'invalid address' }, 400);
        const local = address.split('@')[0];

        const existing = await env.DB.prepare(
          'SELECT local_part, retired FROM used_names WHERE local_part = ?'
        )
          .bind(local)
          .first();
        if (existing) {
          if (existing.retired) {
            return json(
              { error: 'This name was deleted before and cannot be created again.' },
              409
            );
          }
          return json({ address, existed: true });
        }

        await env.DB.prepare(
          'INSERT INTO used_names (local_part, address, created_at, retired) VALUES (?, ?, ?, 0)'
        )
          .bind(local, address, Date.now())
          .run();
        return json({ address });
      }

      // POST /api/delete-address  { address }
      // Retires the name forever (kept in used_names with retired = 1) and
      // deletes every stored message for the address.
      if (url.pathname === '/api/delete-address' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid json' }, 400);
        }
        const address = String(body.address || '').toLowerCase().trim();
        if (!ADDRESS_RE.test(address)) return json({ error: 'invalid address' }, 400);
        const local = address.split('@')[0];

        await env.DB.prepare(
          `INSERT INTO used_names (local_part, address, created_at, retired)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(local_part) DO UPDATE SET address = excluded.address, retired = 1`
        )
          .bind(local, address, Date.now())
          .run();
        await env.DB.prepare('DELETE FROM messages WHERE address = ?')
          .bind(address)
          .run();
        return json({ ok: true });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('api error:', err);
      return json({ error: 'server error' }, 500);
    }
  },
};
