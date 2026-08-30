# Mellemcertifikater

findbolig.nu sender kun sit eget certifikat, ikke mellemcertifikatet
`RapidSSL TLS RSA CA G1`. Browsere henter det selv via AIA-feltet; Node
gør ikke, og fejler med `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Løsningen er at levere det manglende led, **ikke** at slå verifikation
fra. `NODE_TLS_REJECT_UNAUTHORIZED=0` må aldrig bruges her — det ville
slå certifikatkontrol fra for hele processen, altså også for Supabase.

Hent det med:

    curl -sS http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt \
      -o /tmp/rapidssl.crt
    openssl x509 -inform DER -in /tmp/rapidssl.crt \
      -out certs/rapidssl-tls-rsa-ca-g1.pem

Verificér at det er det rigtige, før det bruges:

    openssl x509 -in certs/rapidssl-tls-rsa-ca-g1.pem -noout -subject -issuer

Subject skal være `CN=RapidSSL TLS RSA CA G1`, og issuer skal være en
DigiCert-rod, der allerede er betroet. Kæden verificeres altså stadig
hele vejen op — vi tilføjer kun det led, serveren har glemt.
