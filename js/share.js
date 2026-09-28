/*
 * Liens de partage : la main est compressée (deflate) puis encodée en base64url
 * dans le fragment de l'URL (#m=...). Le fragment n'est jamais envoyé au serveur :
 * la main voyage dans le lien lui-même.
 *
 * Format : <adresse>#m=<main>[&s=<étape>][&v=<siège>]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Replayer = root.Replayer || {};
    Object.assign(root.Replayer, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Version en ligne (GitHub Pages) vers laquelle pointent les liens partagés hors ligne. */
  const PUBLIC_URL = 'https://arthurkzp.github.io/Replayer_Betclic/';
  const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;

  function toBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  async function encodeHand(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'function') {
      try {
        return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
      } catch (e) {
        /* repli ci-dessous */
      }
    }
    return 'b' + toBase64Url(bytes);
  }

  async function decodeHand(token) {
    const kind = token[0];
    const bytes = fromBase64Url(token.slice(1));
    if (kind === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('Navigateur trop ancien pour ouvrir ce lien.');
      return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
    }
    return new TextDecoder().decode(bytes);
  }

  /**
   * Vrai si la page est servie en ligne et ouverte directement (pas en local,
   * pas dans un aperçu intégré) : ses liens peuvent alors être partagés tels quels.
   */
  function isHostedPage(loc, framed) {
    return !!loc && /^https?:$/.test(loc.protocol) && !LOCAL_HOSTS.test(loc.hostname) && !framed;
  }

  function currentLocation() {
    return typeof location !== 'undefined' ? location : null;
  }

  function isFramed() {
    try {
      return typeof window !== 'undefined' && window.top !== window.self;
    } catch (e) {
      return true;
    }
  }

  /** Adresse de base des liens : la page actuelle si elle est en ligne, sinon la version publique. */
  function shareBase(loc, framed) {
    const override = typeof self !== 'undefined' && self.REPLAYER_PUBLIC_URL;
    if (override) return override;
    return isHostedPage(loc, framed) ? loc.href.split('#')[0] : PUBLIC_URL;
  }

  /**
   * Construit le lien de partage.
   * opts : { step, seat, base } — step (index d'étape) et seat (siège de vue) sont facultatifs.
   */
  async function shareUrl(text, opts) {
    const o = opts || {};
    const token = await encodeHand(text);
    let hash = '#m=' + token;
    if (o.step > 0) hash += '&s=' + Math.floor(o.step);
    if (o.seat > 0) hash += '&v=' + Math.floor(o.seat);
    return (o.base || shareBase(currentLocation(), isFramed())) + hash;
  }

  /** Lit un fragment "#m=...&s=...&v=..." ; renvoie null s'il ne contient pas de main. */
  function parseShareHash(hash) {
    const str = String(hash || '');
    const m = str.match(/[#&]m=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const num = (key) => {
      const r = str.match(new RegExp('[#&]' + key + '=(\\d+)'));
      return r ? parseInt(r[1], 10) : null;
    };
    return { token: m[1], step: num('s'), seat: num('v') };
  }

  function tokenFromHash(hash) {
    const parsed = parseShareHash(hash);
    return parsed ? parsed.token : null;
  }

  return {
    PUBLIC_URL,
    encodeHand,
    decodeHand,
    shareUrl,
    shareBase,
    isHostedPage: (loc, framed) => isHostedPage(loc || currentLocation(), framed == null ? isFramed() : framed),
    parseShareHash,
    tokenFromHash,
  };
});
