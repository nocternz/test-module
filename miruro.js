// ============================================================================
// ⚙️ SORA MODULE — MIRURO (Compliant with Sora / Luna / Shirox Engine Spec)
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

function decompressGzipOrRaw(bytes) {
    return safeBytesToString(bytes);
}

// ----------------------------------------------------------------------------
// 🛡️ Miruro Pipe Request Handler
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

        const response = await soraFetch(url, { method: 'GET', headers: headers, opts: { impersonate: "chrome" } });
        if (!response) return null;

        let b64Text = typeof response.text === 'function' ? await response.text() : (response.data || response);
        if (!b64Text || typeof b64Text !== 'string') return null;

        if (b64Text.trim().startsWith("<") || b64Text.toLowerCase().includes("cloudflare") || b64Text.toLowerCase().includes("just a moment")) {
            return { _blocked_by_cloudflare: true };
        }

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

        const jsonStr = decompressGzipOrRaw(bytes);
        return JSON.parse(jsonStr || "{}");
    } catch (err) {
        return null;
    }
}

// ============================================================================
// 🎬 SORA VIDEO MODULE CONTRACTS
// ============================================================================

/**
 * 1. Search Contract
 * Schema: [{ title, image, href }]
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
                    href: `https://www.miruro.to/watch?id=${id}`
                });
            }
            if (results.length > 0) return JSON.stringify(results);
        }

        // Fallback: Miruro pipe search
        const data = await makeSecureRequest("search", { q: keyword, limit: 25, offset: 0, sort: "POPULARITY_DESC", type: "ANIME", isAdult: false });
        if (data && !data._blocked_by_cloudflare) {
            const items = data.results || (Array.isArray(data) ? data : []);
            for (let item of items) {
                if (item.isAdult) continue;
                const id = item.id;
                const title = item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
                const image = item.coverImage?.large || item.coverImage?.medium || "";
                results.push({ title: title, image: image, href: `https://www.miruro.to/watch?id=${id}` });
            }
        }
        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

/**
 * 2. Details Contract
 * Schema: [{ description, aliases, airdate }]
 */
async function extractDetails(url) {
    try {
        const idMatch = url.match(/id=(\d+)/) || url.match(/\/(\d+)/);
        const anilistId = idMatch ? parseInt(idMatch[1]) : null;

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
            body: JSON.stringify({ query: gqlQuery, variables: { id: anilistId } })
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
 * 3. Episodes Contract
 * Schema: [{ href: string, number: number }]
 */
async function extractEpisodes(url) {
    try {
        const idMatch = url.match(/id=(\d+)/) || url.match(/\/(\d+)/);
        const anilistId = idMatch ? idMatch[1] : null;

        if (!anilistId) return JSON.stringify([]);

        const watchUrl = `${BASE_URL}/watch?id=${anilistId}`;
        const pipeData = await makeSecureRequest("episodes", { anilistId: anilistId }, watchUrl);

        const collectedEpisodes = [];
        const seenNumbers = new Set();

        // Recursive traverser to extract episode objects from nested providers/categories
        function traverseAndCollect(node) {
            if (!node) return;
            if (Array.isArray(node)) {
                for (let item of node) {
                    if (item && (item.number !== undefined || item.episode !== undefined || item.ep !== undefined)) {
                        const rawNum = item.number ?? item.episode ?? item.ep;
                        const num = parseFloat(rawNum);
                        if (!isNaN(num) && !seenNumbers.has(num)) {
                            seenNumbers.add(num);
                            collectedEpisodes.push({
                                href: `https://www.miruro.to/watch?id=${anilistId}&ep=${num}`,
                                number: num
                            });
                        }
                    } else if (typeof item === 'object') {
                        traverseAndCollect(item);
                    }
                }
            } else if (typeof node === 'object') {
                for (let key in node) {
                    traverseAndCollect(node[key]);
                }
            }
        }

        if (pipeData && !pipeData._blocked_by_cloudflare) {
            traverseAndCollect(pipeData);
        }

        // Fallback: If Miruro's pipe yields 0 episodes or fails, query total episode count from AniList
        if (collectedEpisodes.length === 0) {
            const countGql = `
                query ($id: Int) {
                    Media(id: $id, type: ANIME) {
                        episodes
                        nextAiringEpisode { episode }
                    }
                }
            `;

            const anilistRes = await soraFetch(ANILIST_GRAPHQL_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ query: countGql, variables: { id: parseInt(anilistId) } })
            });

            let raw = typeof anilistRes?.text === 'function' ? await anilistRes.text() : (anilistRes?.data || anilistRes);
            let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

            let totalCount = parsed?.data?.Media?.episodes;
            if (!totalCount && parsed?.data?.Media?.nextAiringEpisode?.episode) {
                totalCount = parsed.data.Media.nextAiringEpisode.episode - 1;
            }

            // Generate sequential episode list
            if (totalCount && totalCount > 0) {
                for (let i = 1; i <= totalCount; i++) {
                    collectedEpisodes.push({
                        href: `https://www.miruro.to/watch?id=${anilistId}&ep=${i}`,
                        number: i
                    });
                }
            }
        }

        collectedEpisodes.sort((a, b) => a.number - b.number);
        return JSON.stringify(collectedEpisodes);
    } catch (error) {
        return JSON.stringify([]);
    }
}

/**
 * 4. Stream URL Contract
 * Schema: { streams: [{ title: string, streamUrl: string, headers?: Record<string, string> }], subtitles?: string }
 */
async function extractStreamUrl(url) {
    try {
        const idMatch = url.match(/id=(\d+)/);
        const epMatch = url.match(/ep=(\d+(\.\d+)?)/);

        const anilistId = idMatch ? idMatch[1] : null;
        const epNumber = epMatch ? epMatch[1] : "1";

        if (!anilistId) return JSON.stringify({ streams: [] });

        const watchReferer = `${BASE_URL}/watch/${anilistId}/${epNumber}?ep=${epNumber}`;
        const epsData = await makeSecureRequest("episodes", { anilistId: anilistId }, watchReferer);

        const dynamicConfigs = [];
        if (epsData && epsData.providers) {
            for (let provKey in epsData.providers) {
                const provData = epsData.providers[provKey];
                if (provData && provData.episodes && typeof provData.episodes === 'object') {
                    for (let catKey in provData.episodes) {
                        const epList = provData.episodes[catKey];
                        if (Array.isArray(epList)) {
                            const ep = epList.find(e => parseFloat(e.number) === parseFloat(epNumber));
                            if (ep && ep.id) {
                                dynamicConfigs.push({
                                    name: provKey.toLowerCase(),
                                    cat: catKey.toLowerCase(),
                                    id: ep.id,
                                    lang: catKey.toLowerCase().includes('dub') ? "Dub" : "Sub"
                                });
                            }
                        }
                    }
                }
            }
        }

        const streams = [];
        let subtitles = "";

        const providersRequiringAnilistId = ["dune", "zoro", "arc", "kiwi", "telli", "bee", "bun", "nun", "ally", "hop"];

        for (let config of dynamicConfigs) {
            try {
                const reqQuery = {
                    episodeId: config.id,
                    provider: config.name,
                    category: config.cat,
                    ttl: 86400
                };

                if (providersRequiringAnilistId.includes(config.name)) {
                    reqQuery.anilistId = parseInt(anilistId);
                }

                const res = await makeSecureRequest("sources", reqQuery, watchReferer);
                if (!res || res._blocked_by_cloudflare) continue;

                let videoArray = res.sources || res.streams || [];
                let subArray = res.subtitles || [];

                if (!Array.isArray(videoArray) || videoArray.length === 0) {
                    const possibleKeys = [config.cat, 'sub', 'ssub', 'dub', 'hdub', 'hsub'];
                    for (let k of possibleKeys) {
                        if (res[k]?.streams && Array.isArray(res[k].streams)) {
                            videoArray = res[k].streams;
                            subArray = res[k].subtitles || subArray;
                            break;
                        }
                    }
                }

                if (Array.isArray(videoArray)) {
                    for (let s of videoArray) {
                        if (!s.url) continue;

                        let streamUrl = s.url;
                        if (streamUrl.includes("uwu.m3u8")) {
                            streamUrl = streamUrl.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");
                        }

                        const label = s.quality || '1080p';
                        streams.push({
                            title: `${config.name.toUpperCase()} • ${label} • ${config.lang}`,
                            streamUrl: streamUrl,
                            headers: {
                                "Referer": s.referer || `${BASE_URL}/`,
                                "Origin": BASE_URL
                            }
                        });
                    }
                }

                if (!subtitles && Array.isArray(subArray)) {
                    for (let sub of subArray) {
                        const file = sub.url || sub.file || "";
                        const lang = (sub.language || sub.lang || sub.label || "").toLowerCase();
                        if (file && (lang.includes("eng") || lang.includes("english"))) {
                            subtitles = file;
                            break;
                        }
                    }
                }
            } catch (err) {}
        }

        return JSON.stringify({
            streams: streams,
            subtitles: subtitles || undefined
        });
    } catch (error) {
        return JSON.stringify({ streams: [] });
    }
}
