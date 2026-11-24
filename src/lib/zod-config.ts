// Global zod settings. Imported first in main.tsx, before any schema is parsed.
//
// jitless: zod 4 otherwise probes `new Function("")` to decide whether it can
// compile fast parsers. The CSP in public/_headers has no 'unsafe-eval', so the
// probe is blocked and reported as a CSP violation on every page load.
import { z } from "zod";

z.config({ jitless: true });
