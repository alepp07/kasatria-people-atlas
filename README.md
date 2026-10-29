# People Atlas — Kasatria Assignment

A static Three.js CSS3D profile visualization. The profile cards load from the published Google Sheet CSV.

## Google setup

1. In `app.js`, replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with the OAuth 2.0 **Web application Client ID**. Do not add a client secret to this static site.
2. In Google Auth Platform → Clients, add this Authorized JavaScript origin: `https://alepp07.github.io`.
3. In the repository, open Settings → Pages and deploy from the `main` branch, `/(root)`.

The Google Sheet is published as a CSV feed to support live loading. The repository intentionally contains app code only, not a copy of the profile CSV.
