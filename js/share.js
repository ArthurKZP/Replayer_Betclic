/*
 * Liens de partage : la main est compressée (deflate) puis encodée en base64url
 * dans le fragment de l'URL (#m=...). Rien n'est envoyé à un serveur.
 */
(function (root) {
  'use strict';

  const R = (root.Replayer = root.Replayer || {});

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

  async function shareUrl(text) {
    const token = await encodeHand(text);
    return location.href.split('#')[0] + '#m=' + token;
  }

  function tokenFromHash(hash) {
    const m = String(hash || '').match(/[#&]m=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  Object.assign(R, { encodeHand, decodeHand, shareUrl, tokenFromHash });
})(typeof self !== 'undefined' ? self : this);
