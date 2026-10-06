// ============================================================================
// ⚙️ SORA MODULE — MIRURO_TEST (Production Multi-Server Engine v1.1.5)
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

// ----------------------------------------------------------------------------
// 🛡️ Miruro Backend Pipeline
// ----------------------------------------------------------------------------
async function makeSecureRequest(path, query = {}, refererUrl = null) {
    try {
        const payload = { path: path, method: "GET", query: query, body: null, version: "0.2.0" };
        const encodedPayload = base64UrlEncode(payload);
        const url = `${PIPE_URL}?e=${encodedPayload}`;

        const headers = {
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": BASE_URL,
            "Referer": refererUrl || `${BASE_URL}/`,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        };

        const response = await soraFetch(url, { 
            method: 'GET', 
            headers: headers, 
            opts: { impersonate: "chrome" } 
        });
        
        if (!response) return null;

        let b64Text = typeof response.text === 'function' ? await response.text() : (response.data || response);
        if (!b64Text || typeof b64Text !== 'string') return null;

        let b64 = b64Text.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);

        const binaryStr = pureAtob(b64);
        if (!binaryStr) return null;

        const bytes = [];
        for (let i = 0; i < binaryStr.length; i++) bytes.push(binaryStr.charCodeAt(i));

        for (let i = 0; i < bytes.length; i++) {
            bytes[i] ^= OBF_KEY_BYTES[i % OBF_KEY_BYTES.length];
        }

        const jsonStr = inflateRawBytes(bytes);
        return JSON.parse(jsonStr || "{}");
    } catch (err) {
        return null;
    }
}

// ============================================================================
// 🎬 SORA VIDEO MODULE CONTRACTS
// ============================================================================

/**
 * 1. Resilient Search Contract (AniList GraphQL + Miruro Pipe Fallback)
 * Schema: [{ title, image, href }]
 */
async function searchResults(keyword) {
    if (!keyword || !keyword.trim()) return JSON.stringify([]);
    const cleanQuery = keyword.trim();
    const results = [];
    const seenIds = new Set();

    try {
        const gqlQuery = `
            query ($search: String) {
                Page(page: 1, perPage: 25) {
                    media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
                        id
                        title {
                            english
                            romaji
                            native
                            userPreferred
                        }
                        coverImage {
                            extraLarge
                            large
                            medium
                        }
                    }
                }
            }
        `;

        const anilistRes = await soraFetch(ANILIST_GRAPHQL_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ query: gqlQuery, variables: { search: cleanQuery } })
        });

        if (anilistRes) {
            let rawGql = typeof anilistRes.text === 'function' ? await anilistRes.text() : (anilistRes.data || anilistRes);
            let parsedGql = typeof rawGql === 'string' ? JSON.parse(rawGql) : rawGql;

            if (parsedGql?.data?.Page?.media && Array.isArray(parsedGql.data.Page.media)) {
                for (let item of parsedGql.data.Page.media) {
                    const id = String(item.id);
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);

                    const title = item.title?.userPreferred || item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
                    const image = item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium || "https://via.placeholder.com/200x300.png?text=No+Poster";

                    results.push({
                        title: title,
                        image: image,
                        href: `miruro://${id}`
                    });
                }
            }
        }
    } catch (anilistErr) {}

    if (results.length === 0) {
        try {
            const pipeData = await makeSecureRequest("search", {
                q: cleanQuery,
                limit: 25,
                offset: 0,
                sort: "POPULARITY_DESC",
                type: "ANIME",
                isAdult: false
            });

            if (pipeData) {
                let items = pipeData.results || (Array.isArray(pipeData) ? pipeData : []);
                for (let item of items) {
                    if (item.isAdult) continue;
                    const id = String(item.id);
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);

                    const title = item.title?.english || item.title?.romaji || item.title?.native || item.name || "Unknown Title";
                    const image = item.coverImage?.large || item.coverImage?.medium || item.poster || "";

                    results.push({
                        title: title,
                        image: image,
                        href: `miruro://${id}`
                    });
                }
            }
        } catch (pipeErr) {}
    }

    return JSON.stringify(results);
}

/**
 * 2. Details Contract (AniList GraphQL)
 * Schema: [{ description, aliases, airdate }]
 */
async function extractDetails(url) {
    try {
        const anilistId = url.replace('miruro://', '').replace(/[^0-9]/g, '');
        if (!anilistId) return JSON.stringify([{ description: "Unable to parse ID.", aliases: "", airdate: "" }]);

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
 * Schema: [{ href, number }]
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
 * 4. Production Stream URL Contract (Populates All Providers: Kiwi, Zoro, Arc, Sun, etc.)
 * Schema: { streams: [{ title, streamUrl, headers? }], subtitles? }
 */
async function extractStreamUrl(url) {
    try {
        const parts = url.replace('miruro-play://', '').split('/');
        const anilistId = parts[0];
        const targetEp = parseFloat(parts.length > 2 ? parts[2] : parts[1]);

        if (!anilistId) return JSON.stringify({ streams: [] });

        const watchReferer = `${BASE_URL}/watch/${anilistId}/${targetEp}?ep=${targetEp}`;

        // 1. Fetch provider episode structure
        const epsData = await makeSecureRequest("episodes", { anilistId: anilistId }, watchReferer);
        
        const targets = [];
        const seenTargets = new Set();

        if (epsData && epsData.providers) {
            for (let provKey in epsData.providers) {
                const prov = epsData.providers[provKey];
                const cleanProv = provKey.toLowerCase();

                if (prov && prov.episodes && typeof prov.episodes === 'object') {
                    for (let catKey in prov.episodes) {
                        const list = prov.episodes[catKey];
                        if (Array.isArray(list)) {
                            const match = list.find(e => parseFloat(e.number) === targetEp);
                            if (match && match.id) {
                                const targetPath = match.id.startsWith("watch/")
                                    ? match.id
                                    : `watch/${cleanProv}/${anilistId}/${catKey.toLowerCase()}/${match.id}`;
                                
                                if (!seenTargets.has(targetPath)) {
                                    seenTargets.add(targetPath);
                                    targets.push({
                                        path: targetPath,
                                        provider: cleanProv,
                                        cat: catKey.toLowerCase(),
                                        id: match.id,
                                        lang: catKey.toUpperCase()
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Direct server fallbacks if the episode tree is minimal
        if (targets.length === 0) {
            const fallbackServers = ["kiwi", "zoro", "arc", "sun", "hop", "telli"];
            for (let s of fallbackServers) {
                targets.push({
                    path: `watch/${s}/${anilistId}/sub/${targetEp}`,
                    provider: s,
                    cat: "sub",
                    id: `${anilistId}-${targetEp}`,
                    lang: "SUB"
                });
            }
        }

        const streams = [];
        let primarySubtitle = "";

        // 2. Query each provider route and assemble the full selection list
        for (let t of targets) {
            try {
                let res = await makeSecureRequest(t.path, {}, watchReferer);
                
                // Fallback to query format if direct watch path returned empty
                if (!res || (!res.streams && !res.sources)) {
                    res = await makeSecureRequest("sources", {
                        episodeId: t.id,
                        provider: t.provider,
                        category: t.cat,
                        anilistId: parseInt(anilistId),
                        ttl: 86400
                    }, watchReferer);
                }

                if (!res) continue;

                let videoList = res.streams || res.sources || [];
                let subList = res.subtitles || [];

                if (Array.isArray(videoList)) {
                    for (let s of videoList) {
                        if (!s.url) continue;

                        let streamUrl = s.url;
                        if (streamUrl.includes("uwu.m3u8")) {
                            streamUrl = streamUrl.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");
                        }

                        const quality = s.quality || 'Auto';
                        streams.push({
                            title: `${t.provider.toUpperCase()} • ${quality} • ${t.lang}`,
                            streamUrl: streamUrl,
                            headers: {
                                "Referer": s.referer || `${BASE_URL}/`,
                                "Origin": BASE_URL,
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                            }
                        });
                    }
                }

                // Capture English subtitles if available
                if (!primarySubtitle && Array.isArray(subList)) {
                    for (let sub of subList) {
                        const file = sub.url || sub.file;
                        const label = (sub.language || sub.lang || sub.label || "").toLowerCase();
                        if (file && (label.includes("eng") || label.includes("english"))) {
                            primarySubtitle = file;
                            break;
                        }
                    }
                }
            } catch (err) {}
        }

        return JSON.stringify({
            streams: streams,
            subtitles: primarySubtitle || undefined
        });
    } catch (error) {
        return JSON.stringify({ streams: [] });
    }
}
