// ═══════════════════════════════════════════════════════════════
//  Hvem koerer.
//
//  Ligger i sin EGEN fil, fordi baade importlaget og vaertsspaerren skal
//  bruge den. Stod den i lib/ingest.ts, ville spaerre-modulet importere
//  hele importlaget for at faa fat i én streng — og lib/fetch.ts, som
//  adapterne bygger paa, ville traekke databasen med ind.
//
//  Identiteten er ogsaa EGRESS-identiteten: vaertsspaerren noegler paa
//  den, fordi en 429/503 hoerer til den IP, der blev droevlet. Railway
//  saetter RUNNER=railway udtrykkeligt — container-hostnames skifter ved
//  hver deploy, og uden det ville Railway miste sin egen spaerre-
//  hukommelse, praecis naar den er noget vaerd.
// ═══════════════════════════════════════════════════════════════

import { hostname } from 'node:os'

export const RUNNER = process.env.RUNNER ?? hostname()
