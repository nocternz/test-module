// ============================================================================
// ⚙️ SORA MODULE — MIRURO (Pure Pipeline with Embedded Deflate)
// ============================================================================

const BASE_URL = "https://barelystarted.miruro.tv";
const PIPE_URL = "https://barelystarted.miruro.tv/api/secure/pipe";
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
// 🛠️ Pure JS Base64 Helpers
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

// ----------------------------------------------------------------------------
// 📦 Self-Contained Deflate Decompressor
// ----------------------------------------------------------------------------
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

        const jsonStr = inflateRawBytes(bytes);
        return JSON.parse(jsonStr || "{}");
    } catch (err) {
        return null;
    }
}

// ============================================================================
// 🎬 SORA VIDEO MODULE CONTRACTS
// ============================================================================

async function searchResults(keyword) {
    try {
        const data = await makeSecureRequest("search", {
            q: keyword,
            limit: 30,
            offset: 0,
            sort: "POPULARITY_DESC",
            type: "ANIME",
            isAdult: false
        });

        if (!data || data._blocked_by_cloudflare) {
            return JSON.stringify([]);
        }

        const results = [];
        let items = [];

        if (data && data.results) items = data.results;
        else if (Array.isArray(data)) items = data;

        for (let item of items) {
            if (item.isAdult === true) continue;
            if (item.genres && Array.isArray(item.genres) && item.genres.includes("Hentai")) continue;

            const id = item.id;
            const title = item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
            const image = item.coverImage?.large || item.coverImage?.medium || "https://via.placeholder.com/200x300.png?text=No+Poster";

            results.push({
                title: title,
                image: image,
                href: `miruro://${id}`
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const anilistId = url.replace('miruro://', '').replace(/[^0-9]/g, '');
        const data = await makeSecureRequest(`info/anilist/${anilistId}`);

        if (!data || data._blocked_by_cloudflare) {
            return JSON.stringify([{ description: "Metadata loading error.", aliases: "", airdate: "" }]);
        }

        let description = "No description available.";
        let year = "Unknown";
        let rating = "N/A";

        if (data.description) description = data.description.replace(/<[^>]+>/g, '').trim();
        if (data.seasonYear) year = String(data.seasonYear);
        if (data.averageScore) rating = `${data.averageScore}/100`;

        return JSON.stringify([{
            description: description,
            aliases: `Score: ${rating}`,
            airdate: `Year: ${year}`
        }]);
    } catch (error) {
        return JSON.stringify([{ description: "Loading error.", aliases: "", airdate: "" }]);
    }
}

async function extractEpisodes(url) {
    try {
        const anilistId = url.replace('miruro://', '').replace(/[^0-9]/g, '');
        const data = await makeSecureRequest("episodes", { anilistId: anilistId });

        if (!data || data._blocked_by_cloudflare) return JSON.stringify([]);

        let allEps = [];
        function searchEpisodes(obj) {
            if (Array.isArray(obj)) {
                if (obj.length > 0 && obj[0].id !== undefined && obj[0].number !== undefined) {
                    allEps = allEps.concat(obj);
                } else {
                    obj.forEach(searchEpisodes);
                }
            } else if (typeof obj === 'object' && obj !== null) {
                Object.values(obj).forEach(searchEpisodes);
            }
        }
        searchEpisodes(data);

        const uniqueEps = [];
        const seenNumbers = new Set();

        for (let ep of allEps) {
            const num = parseFloat(ep.number);
            if (!isNaN(num) && !seenNumbers.has(num)) {
                seenNumbers.add(num);
                uniqueEps.push({
                    href: `miruro-play://${anilistId}/${num}`,
                    number: num
                });
            }
        }

        uniqueEps.sort((a, b) => a.number - b.number);
        return JSON.stringify(uniqueEps);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const parts = url.replace('miruro-play://', '').split('/');
        const anilistId = parts[0];
        const epNumber = parts.length > 2 ? parts[2] : parts[1];

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
                                    lang: catKey.toLowerCase().includes('dub') ? "DUB" : "SUB"
                                });
                            }
                        }
                    }
                }
            }
        }

        if (dynamicConfigs.length === 0) {
            return JSON.stringify({ streams: [] });
        }

        const streams = [];
        let subtitles = "";

        const providersRequiringAnilistId = [
            "dune", "zoro", "arc", "kiwi", "telli", "bee", "bun", "nun", "ally", "hop"
        ];

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
                        } else if (res[k]?.sources && Array.isArray(res[k].sources)) {
                            videoArray = res[k].sources;
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
                            title: `Server ${config.name.toUpperCase()} (${label}) [${config.lang}]`,
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
            } catch (e) {}
        }

        return JSON.stringify({
            streams: streams,
            subtitles: subtitles || undefined
        });
    } catch (error) {
        return JSON.stringify({ streams: [] });
    }
}
