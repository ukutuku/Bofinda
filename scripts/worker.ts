// Den lange proces paa Railway.
import { start } from '../lib/scheduler'
import { sql } from '../db/client'
await start()
await sql.end()
