# Dev panel

Live parameter tweaking for the card, using
[DialKit](https://github.com/joshpuckett/dialkit).

```sh
cd dev && npm install
npm run build      # bundles panel.jsx -> panel.js
node server.js     # http://localhost:4321
```

`server.js` serves the **repo root**, so every relative asset path resolves
exactly as it does in production, and injects the panel into `index.html` on
the way out. Nothing is written to the production files, and none of this
ships — the card itself stays vanilla with no build step.

The panel writes to `window.CARD_PARAMS` (defined in `card.js`) and fires a
`card-params-changed` event so geometry-affecting changes get re-applied.
After tweaking, copy the values back into the `params` defaults in `card.js`.

Re-run `npm run build` after editing `panel.jsx`.

**The gyroscope will not work over the LAN address.** It needs a secure
context; `localhost` counts, a LAN IP does not. Use the Vercel preview to test
real tilt on a phone.
