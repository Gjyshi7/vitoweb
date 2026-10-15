// Usage meter: counts exactly what Cloudflare bills, by kind. Off on the live site; on with `wrangler dev --var METER:1`.
//   worker   one Worker invocation (Free: 100,000 / day)
//   do       one Durable Object request: alarm, RPC call, WebSocket connect (Free: 100,000 / day)
//   wsmsg    one incoming WebSocket message (billed 20 messages = 1 request)
//   rows     rows written to Durable Object storage: put, delete, setAlarm, SQL writes (Free: 100,000 / day)
export function meter(env, kind, what, n = 1) {
  if (env && env.METER === "1" && n) console.log(`METER ${kind} ${what} ${n}`);
}
