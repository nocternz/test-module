// ============================================================================
// ⚙️ SORA MODULE — MIRURO_TEST (Reverted to miruro.to + Diagnostics)
// ============================================================================

const BASE_URL = "https://www.miruro.to";
const PIPE_URL = "https://www.miruro.to/api/secure/pipe";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const MIRURO_PIPE_OBF_KEY = "71951034f8fbcf53d89db52ceb3dc22c";

const OBF_KEY_BYTES = [];
for (let i = 0; i < MIRURO_PIPE_OBF_KEY.length; i += 2) {
    OBF_KEY_BYTES.push(parseInt(MIRURO_PIPE_OBF_KEY.substr(i, 2), 16));
}

// ----------------------------------------------------------------------------
// 🌐 Network Helper: fetchv2 Abstraction
// ----------------------------------------------------------------------------
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, opts: null }) {
    const headers = options.headers || {};
    if (!headers["User-Agent"]) {
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    }
    const method = options.method || 'GET';
    const body = options.body || null;
    const fetchOpts = options.opts || { impersonate: "chrome" };

    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, headers, method, body, fetchOpts);
        }
        return await fetch(url, { headers, method, body });
    } catch (e) {
        try {
            return await fetch(url, { headers, method, body });
        } catch (error) {
            return null;
        }
    }
}

// ----------------------------------------------------------------------------
// 🛠️ Pure JS Base64 / Binary Helpers
// ----------------------------------------------------------------------------
function pureBtoa(input) {
    let str = String(input);
    let output = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    for (let block = 0, charCode, i = 0, map = chars;
        str.charAt(i | 0) || (map = '=', i % 1);
        output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
        charCode = str.charCodeAt(i += 3/4);
        block = block << 8 | charCode;
    }
    return output;
}

function pureAtob(input) {
    let str = String(input).replace(/=+$/, '');
    if (str.length % 4 === 1) return null;
    let output = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    for (let bc = 0, bs = 0, buffer, i = 0;
        buffer = str.charAt(i++);
        ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
    ) {
        buffer = chars.indexOf(buffer);
    }
    return output;
}

function base64UrlEncode(obj) {
    const jsonStr = JSON.stringify(obj);
    const utf8Str = unescape(encodeURIComponent(jsonStr));
    const b64 = pureBtoa(utf8Str);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeBytesToString(u8arr) {
    let s = "";
    for (let i = 0; i < u8arr.length; i++) s += String.fromCharCode(u8arr[i]);
    try {
        return decodeURIComponent(escape(s));
    } catch (e) {
        return s;
    }
}

function inflateRawBytes(bytes) {
    const directStr = safeBytesToString(bytes);
    if (directStr && (directStr.trim().startsWith("{") || directStr.trim().startsWith("["))) {
        return directStr;
    }
    let offset = 0;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        offset = 10;
        const flg = bytes[3];
        if (flg & 4) { const xlen = bytes[offset] | (bytes[offset + 1] << 8); offset += 2 + xlen; }
        if (flg & 8) { while (bytes[offset++] !== 0); }
        if (flg & 16) { while (bytes[offset++] !== 0); }
        if (flg & 2) { offset += 2; }
    } else if ((bytes[0] & 0x0f) === 0x08) {
        offset = 2;
    }
    return safeBytesToString(bytes.slice(offset));
}

// ============================================================================
// 🎬 SORA VIDEO MODULE CONTRACTS
// ============================================================================

/**
 * 1. Search Contract (AniList GraphQL)
 */
async function searchResults(keyword) {
    try {
        const gqlQuery = `
            query ($search: String) {
                Page(page: 1, perPage: 25) {
                    media(search: $search, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
                        id
                        title { romaji english native }
                        coverImage { large medium }
                    }
                }
            }
        `;

        const anilistRes = await soraFetch(ANILIST_GRAPHQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query: gqlQuery, variables: { search: keyword } })
        });

        let rawGql = typeof anilistRes?.text === 'function' ? await anilistRes.text() : (anilistRes?.data || anilistRes);
        let parsedGql = typeof rawGql === 'string' ? JSON.parse(rawGql) : rawGql;

        const results = [];
        if (parsedGql?.data?.Page?.media && Array.isArray(parsedGql.data.Page.media)) {
            for (let item of parsedGql.data.Page.media) {
                const id = item.id;
                const title = item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
                const image = item.coverImage?.large || item.coverImage?.medium || "https://via.placeholder.com/200x300.png?text=No+Poster";
                results.push({
                    title: title,
                    image: image,
                    href: `miruro://${id}`
                });
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

/**
 * 2. Details Contract (AniList GraphQL)
 */
async function extractDetails(url) {
    try {
        const anilistId = url.replace('miruro://', '').replace(/[^0-9]/g, '');
        if (!anilistId) {
            return JSON.stringify([{ description: "Unable to parse ID.", aliases: "", airdate: "" }]);
        }

        const gqlQuery = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    description(asHtml: false)
                    seasonYear
                    averageScore
                    synonyms
                }
            }
        `;

        const res = await soraFetch(ANILIST_GRAPHQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query: gqlQuery, variables: { id: parseInt(anilistId) } })
        });

        let raw = typeof res?.text === 'function' ? await res.text() : (res?.data || res);
        let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (parsed?.data?.Media) {
            const media = parsed.data.Media;
            const description = (media.description || "No description available.").replace(/<[^>]+>/g, '').trim();
            const airdate = media.seasonYear ? String(media.seasonYear) : "Unknown";
            const aliases = Array.isArray(media.synonyms) && media.synonyms.length > 0 
                ? media.synonyms.join(", ") 
                : (media.averageScore ? `Score: ${media.averageScore}/100` : "");

            return JSON.stringify([{
                description: description,
                aliases: aliases,
                airdate: airdate
            }]);
        }

        return JSON.stringify([{ description: "Metadata unavailable.", aliases: "", airdate: "" }]);
    } catch (error) {
        return JSON.stringify([{ description: "Metadata parsing failed.", aliases: "", airdate: "" }]);
    }
}

/**
 * 3. Episodes Contract (AniList GraphQL Direct Numbering)
 */
async function extractEpisodes(url) {
    try {
        const anilistId = url.replace('miruro://', '').replace(/[^0-9]/g, '');
        if (!anilistId) return JSON.stringify([]);

        const gqlQuery = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    episodes
                    status
                    nextAiringEpisode { episode }
                }
            }
        `;

        const anilistRes = await soraFetch(ANILIST_GRAPHQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query: gqlQuery, variables: { id: parseInt(anilistId) } })
        });

        let raw = typeof anilistRes?.text === 'function' ? await anilistRes.text() : (anilistRes?.data || anilistRes);
        let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        let totalEpisodes = parsed?.data?.Media?.episodes;

        if (!totalEpisodes && parsed?.data?.Media?.nextAiringEpisode?.episode) {
            totalEpisodes = parsed.data.Media.nextAiringEpisode.episode - 1;
        }

        if (!totalEpisodes || totalEpisodes < 1) {
            totalEpisodes = 1;
        }

        const episodes = [];
        for (let ep = 1; ep <= totalEpisodes; ep++) {
            episodes.push({
                href: `miruro-play://${anilistId}/${ep}`,
                number: ep
            });
        }

        return JSON.stringify(episodes);
    } catch (error) {
        return JSON.stringify([]);
    }
}

/**
 * 4. Diagnostic Stream URL Contract (Surfaces Pipe Output to App UI)
 */
async function extractStreamUrl(url) {
    const logs = [];
    try {
        const parts = url.replace('miruro-play://', '').split('/');
        const anilistId = parts[0];
        const targetEp = parseFloat(parts.length > 2 ? parts[2] : parts[1]);
        const watchReferer = `${BASE_URL}/watch/${anilistId}/${targetEp}?ep=${targetEp}`;

        logs.push(`Domain: miruro.to`);
        logs.push(`ID: ${anilistId} | EP: ${targetEp}`);

        // Construct pipe payload
        const payload = { path: "episodes", method: "GET", query: { anilistId: anilistId }, body: null, version: "0.2.0" };
        const encodedPayload = base64UrlEncode(payload);
        const testUrl = `${PIPE_URL}?e=${encodedPayload}`;

        const res = await soraFetch(testUrl, {
            method: 'GET',
            headers: {
                "Accept": "*/*",
                "Origin": BASE_URL,
                "Referer": watchReferer
            },
            opts: { impersonate: "chrome" }
        });

        if (!res) {
            logs.push("Fetch Result: null response");
        } else {
            const rawText = typeof res.text === 'function' ? await res.text() : (res.data || String(res));
            logs.push(`HTTP Length: ${rawText ? rawText.length : 0}`);
            logs.push(`Raw: ${String(rawText).slice(0, 30).replace(/\n/g, '')}`);

            try {
                let b64 = rawText.replace(/-/g, '+').replace(/_/g, '/');
                const pad = b64.length % 4;
                if (pad) b64 += '='.repeat(4 - pad);
                const binaryStr = pureAtob(b64);
                
                if (!binaryStr) {
                    logs.push("Decode: Base64 decode failed");
                } else {
                    const bytes = [];
                    for (let i = 0; i < binaryStr.length; i++) bytes.push(binaryStr.charCodeAt(i));
                    for (let i = 0; i < bytes.length; i++) bytes[i] ^= OBF_KEY_BYTES[i % OBF_KEY_BYTES.length];
                    const decodedStr = inflateRawBytes(bytes);
                    
                    logs.push(`Decoded Len: ${decodedStr.length}`);
                    logs.push(`Decoded: ${decodedStr.slice(0, 35).replace(/\n/g, '')}`);
                }
            } catch (decErr) {
                logs.push(`Dec Err: ${decErr.message}`);
            }
        }
    } catch (err) {
        logs.push(`Crash: ${err.message}`);
    }

    return JSON.stringify({
        streams: logs.map(msg => ({
            title: msg,
            streamUrl: "https://invalid.test/stream.m3u8"
        }))
    });
}
