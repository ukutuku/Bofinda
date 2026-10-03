// Et klientevent fjernes fra KLIENTEVENTS. Ruten ville smide det væk uden
// en loglinje; nu må meld() ikke kaldes med det.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "'contact_click', 'listing_impression', 'search_submitted',\n] as const satisfies",
  traeffere: 1,
  erstat: "'listing_impression', 'search_submitted',\n] as const satisfies",
}
