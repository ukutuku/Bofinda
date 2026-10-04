// ═══════════════════════════════════════════════════════════════
//  TESTDOBLER TIL scripts/hent-laros-raasvar.mjs
//
//  Erstatter `globalThis.fetch` og `globalThis.setTimeout`. Der sendes
//  INGEN rigtige kald, og der ventes ingen rigtig tid: ventetider logges
//  og fremskyndes. Scriptet under proeve aendres ikke.
//
//  Grundstammen er koordineringssessionens egen harness fra
//  slutkontrollen, saa foer- og efter-maalinger er sammenlignelige. De
//  fem sidste sager er lagt til her, til de forhold rettelsen daekker.
//
//  Simuleret ventetid er IKKE virkelig netvaerkstakt: proeven maaler
//  kontrolfloaden og de ANMODEDE ventetider, ikke hvad en vaert oplever.
// ═══════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const mode = process.env.PROBE_CASE;
const out = process.env.PROBE_OUT;
const calls = [], waits = [];
let elapsed = 0;
globalThis.setTimeout = (fn, ms, ...args) => { waits.push(ms); elapsed += Number(ms); queueMicrotask(() => fn(...args)); return 1; };
const good = () => new Response('<html><div class="address">TEST</div></html>\n', {status: 200, headers: {'content-type':'text/html'}});
const denied = () => new Response('Host not in allowlist: www.laros.dk. Add this host to your network egress settings to allow access.', {status:403, headers:{'content-type':'text/plain','x-deny-reason':'host_not_allowed'}});
const broken = () => ({status:200, headers:new Headers({'content-type':'text/html'}), arrayBuffer:async () => { throw new TypeError('PROBE: response body terminated after headers'); }});
globalThis.fetch = async (url, opts) => {
 calls.push({url:String(url),opts,scheduledMilliseconds:elapsed});
 if (mode === 'gateway-no-proxy') return denied();
 if (mode === 'body-fails-first') return broken();
 if (mode === 'body-fails-second') return calls.length === 1 ? good() : broken();
 if (mode === 'fetch-fails') throw new TypeError('PROBE: connection refused');
 if (mode === 'redirect' && calls.length === 1) return new Response(null,{status:302,headers:{location:'/test-target'}});
 if (mode === 'retry-after-redirect' && calls.length === 1) return new Response(null,{status:302,headers:{location:'/test-target','retry-after':'600'}});
 if (mode === 'retry-after-503' && calls.length === 1) return new Response('PROBE unavailable',{status:503,headers:{'retry-after':'600'}});
 // ── tilfoejet af Supply: de sager, rettelsen skal daekke ──
 // HTTP-dato i Retry-After (RFC 9110 tillader begge former).
 if (mode === 'retry-after-dato' && calls.length === 1) return new Response(null,{status:302,headers:{location:'/test-target','retry-after':new Date(Date.now()+600000).toUTCString()}});
 // Kort Retry-After: under grundtakten, maa ikke forkorte de 20 s.
 if (mode === 'retry-after-kort' && calls.length === 1) return new Response(null,{status:302,headers:{location:'/test-target','retry-after':'5'}});
 // 403 paa foerste listeside: anden side maa ikke hentes.
 if (mode === 'afslag-403') return denied();
 // 429 paa foerste listeside.
 if (mode === 'afslag-429' && calls.length === 1) return new Response('PROBE rate limited',{status:429,headers:{'content-type':'text/plain'}});
 // Gateway-afslag MED proxyvariabel sat — samme svar som uden.
 if (mode === 'gateway-med-proxy') return denied();
 return good();
};
process.on('exit', code => {
 writeFileSync(join(out,'harness.json'), JSON.stringify({mode,code,calls,waits,network:'ALL fetch calls replaced, no network access',timer:'all setTimeout calls logged and fast-forwarded'},null,2));
});
