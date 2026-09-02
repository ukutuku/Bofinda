import type { NextConfig } from 'next'

const config: NextConfig = {
  // findbolig.nu sender ikke sit mellemcertifikat. Lokalt loeses det af
  // NODE_EXTRA_CA_CERTS i npm-scriptet — men paa Vercel koerer
  // serverless-funktionerne ikke gennem npm, saa variablen skal saettes i
  // panelet OG filen skal med i bundtet. Uden det her findes den ikke ved
  // koerselstid, og alle findbolig-billeder fejler med
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE.
  outputFileTracingIncludes: {
    '/api/billede': ['./certs/**'],
  },
}

export default config
