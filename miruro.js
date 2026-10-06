// ==========================================
// ⚙️ SORA MODULE — MIRURO (Node.js/VM Sandbox)
// ==========================================

const BASE_URL = "https://www.miruro.to";
const PIPE_URL = "https://www.miruro.to/api/secure/pipe";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const MIRURO_PIPE_OBF_KEY = "71951034f8fbcf53d89db52ceb3dc22c";

// 🌟 SECURE GLOBAL DETECTION
let _global;
try { _global = globalThis; } catch(e) { 
    try { _global = window; } catch(e) { 
        try { _global = global; } catch(e) { _global = this; } 
    } 
}

const OBF_KEY_BYTES = [];
for (let i = 0; i < MIRURO_PIPE_OBF_KEY.length; i += 2) {
    OBF_KEY_BYTES.push(parseInt(MIRURO_PIPE_OBF_KEY.substr(i, 2), 16));
}

// ==========================================
// 🗄️ SUPABASE TRACKER
// ==========================================
const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = { 
            "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Prefer": "return=minimal" 
        };
        await soraFetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
    } catch (e) {
        console.log(`[Tracker] 🚨 Erreur d'envoi vers Supabase : ${e.message}`);
    }
}

// ==========================================
// 🛠️ DECRYPTION ENGINE (Pure JS Polyfills)
// ==========================================

function pureBtoa(input) {
    let str = String(input); let output = '';
    let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
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
    if (str.length % 4 == 1) return null;
    let output = '';
    let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    for (let bc = 0, bs = 0, buffer, i = 0;
        buffer = str.charAt(i++);
        ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
    ) { buffer = chars.indexOf(buffer); }
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
    for(let i = 0; i < u8arr.length; i++) s += String.fromCharCode(u8arr[i]);
    try { return decodeURIComponent(escape(s)); } catch(e) { return s; }
}

async function ensurePako() {
    if (_global && _global.pako) return;
    try {
        const res = await soraFetch("https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js");
        const code = typeof res.text === 'function' ? await res.text() : (res.data || res);
        const runner = new Function('window', 'global', 'globalThis', code);
        runner(_global, _global, _global);
    } catch (e) { 
        console.log("[Miruro] 🚨 Pako Error : " + e.message); 
    }
}

// ==========================================
// 🛡️ REACTOR CORE (Miruro Pipe)
// ==========================================

async function makeSecureRequest(path, query = {}, refererUrl = null) {
    await ensurePako();

    const payload = { path: path, method: "GET", query: query, body: null, version: "0.2.0" };
    const encodedPayload = base64UrlEncode(payload);
    
    const url = `${PIPE_URL}?e=${encodedPayload}`;

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": BASE_URL,
        "Referer": refererUrl || `${BASE_URL}/`, 
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    let b64Text = "";
    
    try {
        let response = await soraFetch(url, { method: 'GET', headers: headers });
        if (response) {
            b64Text = typeof response.text === 'function' ? await response.text() : (response.data || response);
        }
    } catch(e) {
        console.error(`[X-Ray] ❌ Network crash : ${e.message}`);
    }

    if (!b64Text || typeof b64Text !== 'string') return null;

    if (b64Text.trim().startsWith("<") || b64Text.toLowerCase().includes("cloudflare") || b64Text.toLowerCase().includes("just a moment")) {
        console.error(`[Pipe] ❌ API Rejected (Cloudflare).`);
        return { _blocked_by_cloudflare: true };
    }

    let b64 = b64Text.replace(/-/g, '+').replace(/_/g, '/');
    let pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);

    const binaryStr = pureAtob(b64);
    if (!binaryStr) return null;

    const bytes = [];
    for (let i = 0; i < binaryStr.length; i++) bytes.push(binaryStr.charCodeAt(i));

    let jsonStr = "";
    let isDecompressed = false;

    for (let i = 0; i < bytes.length; i++) bytes[i] ^= OBF_KEY_BYTES[i % OBF_KEY_BYTES.length];
    
    if (_global && _global.pako) {
        try {
            jsonStr = _global.pako.ungzip(bytes, { to: 'string' });
            isDecompressed = true;
        } catch (e1) {
            try { 
                jsonStr = _global.pako.inflate(bytes, { to: 'string' }); 
                isDecompressed = true; 
            } catch (e2) {}
        }
    }

    if (!isDecompressed) {
        jsonStr = safeBytesToString(bytes);
    }

    try {
        return JSON.parse(jsonStr || "");
    } catch (parseError) {
        return null;
    }
}

// ==========================================
// ⚙️ SORA MODULE LOGIC
// ==========================================

async function searchResults(keyword) {
    console.log(`[Search] 🔍 Searching via AniList GraphQL & Miruro Pipe fallback: "${keyword}"`);
    try {
        // Step 1: Direct AniList GraphQL Query (Bypasses Miruro Cloudflare/Pipe blocks)
        const gqlQuery = `
            query ($search: String) {
                Page(page: 1, perPage: 25) {
                    media(search: $search, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
                        id
                        title {
                            romaji
                            english
                            native
                        }
                        coverImage {
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
            body: JSON.stringify({
                query: gqlQuery,
                variables: { search: keyword }
            })
        });

        let rawGql = typeof anilistRes?.text === 'function' ? await anilistRes.text() : (anilistRes?.data || anilistRes);
        let parsedGql = null;

        try {
            parsedGql = typeof rawGql === 'string' ? JSON.parse(rawGql) : rawGql;
        } catch (err) {}

        const results = [];

        if (parsedGql?.data?.Page?.media && Array.isArray(parsedGql.data.Page.media)) {
            for (let item of parsedGql.data.Page.media) {
                const id = item.id;
                const title = item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
                const image = item.coverImage?.large || item.coverImage?.medium || "https://via.placeholder.com/200x300.png?text=No+Poster";
                results.push({ title: title, image: image, href: `miruro://${id}` });
            }

            if (results.length > 0) {
                sendSupabaseLog("Miruro", "SEARCH", { 
                    keyword: keyword, 
                    results_count: results.length,
                    top_results: results.slice(0, 3).map(r => r.title)
                });
                return JSON.stringify(results);
            }
        }

        // Step 2: Fallback to Pipe URL if AniList API is unreachable
        const data = await makeSecureRequest("search", {
            q: keyword, 
            limit: 30, 
            offset: 0, 
            sort: "POPULARITY_DESC", 
            type: "ANIME",
            isAdult: false 
        });

        if (data && !data._blocked_by_cloudflare) {
            let items = data.results || (Array.isArray(data) ? data : []);
            for (let item of items) {
                if (item.isAdult === true) continue;
                const id = item.id;
                const title = item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title";
                const image = item.coverImage?.large || item.coverImage?.medium || "https://via.placeholder.com/200x300.png?text=No+Poster";
                results.push({ title: title, image: image, href: `miruro://${id}` });
            }
        }

        sendSupabaseLog("Miruro", "SEARCH", { 
            keyword: keyword, 
            results_count: results.length,
            top_results: results.slice(0, 3).map(r => r.title)
        });
        
        return JSON.stringify(results);

    } catch (error) { 
        sendSupabaseLog("Miruro", "ERROR", { keyword: keyword, error_message: String(error) });
        return JSON.stringify([]); 
    }
}

async function extractDetails(url) {
    const id = url.replace('miruro://', '');
    const finalMediaUrl = `${BASE_URL}/watch?id=${id}`;

    try {
        // Direct GraphQL metadata fallback
        const gqlQuery = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    description(asHtml: false)
                    seasonYear
                    averageScore
                }
            }
        `;

        const res = await soraFetch(ANILIST_GRAPHQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query: gqlQuery, variables: { id: parseInt(id) } })
        });

        let raw = typeof res?.text === 'function' ? await res.text() : (res?.data || res);
        let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (parsed?.data?.Media) {
            const media = parsed.data.Media;
            const description = (media.description || "No description available.").replace(/<[^>]+>/g, '').trim();
            const year = media.seasonYear ? `Year: ${media.seasonYear}` : "Year: Unknown";
            const rating = media.averageScore ? `Score: ${media.averageScore}/100` : "Score: N/A";

            return JSON.stringify([{ description: description, aliases: rating, airdate: year }]);
        }

        // Secondary fallback to Miruro pipe
        const data = await makeSecureRequest(`info/anilist/${id}`);
        let description = "No description available.";
        let year = "Unknown"; 
        let rating = "N/A";

        if (data && !data._blocked_by_cloudflare) {
            if (data.description) description = data.description.replace(/<[^>]+>/g, '').trim();
            if (data.seasonYear) year = data.seasonYear;
            if (data.averageScore) rating = `${data.averageScore}/100`;
        }

        return JSON.stringify([{ description: description, aliases: `Score: ${rating}`, airdate: `Year: ${year}` }]);
    } catch (error) { 
        sendSupabaseLog("Miruro", "ERROR", { media_url: finalMediaUrl, error_message: String(error) });
        return JSON.stringify([{ description: 'Loading error.', aliases: '', airdate: '' }]); 
    }
}

async function extractEpisodes(url) {
    try {
        const anilistId = url.replace('miruro://', '');
        const data = await makeSecureRequest("episodes", { anilistId: anilistId });
        
        if (!data || data._blocked_by_cloudflare) return JSON.stringify([]);

        let allEps = [];
        function searchEpisodes(obj) {
            if (Array.isArray(obj)) {
                if (obj.length > 0 && obj[0].id !== undefined && obj[0].number !== undefined) allEps = allEps.concat(obj);
                else obj.forEach(searchEpisodes);
            } else if (typeof obj === 'object' && obj !== null) Object.values(obj).forEach(searchEpisodes);
        }
        searchEpisodes(data);

        const uniqueEps = [];
        const seenNumbers = new Set();
        
        for (let ep of allEps) {
            if (!seenNumbers.has(ep.number)) {
                seenNumbers.add(ep.number);
                uniqueEps.push({
                    href: `miruro-play://${anilistId}/${ep.number}`,
                    number: ep.number, season: 1, title: ep.title || `Episode ${ep.number}`
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
    let startTime = Date.now(); 
    let finalMediaUrl = url; 
    let epNumber = 1;
    
    try {
        const parts = url.replace('miruro-play://', '').split('/');
        const anilistId = parts[0];
        epNumber = parts.length > 2 ? parts[2] : parts[1];
        
        const watchReferer = `${BASE_URL}/watch/${anilistId}/${epNumber}?ep=${epNumber}`;
        finalMediaUrl = watchReferer;

        const epsData = await makeSecureRequest("episodes", { anilistId: anilistId });
        
        let dynamicConfigs = []; 
        let failedLinks = []; 
        
        if (epsData && epsData.providers) {
            for (let provKey in epsData.providers) {
                const provData = epsData.providers[provKey];
                
                if (provData && provData.episodes && typeof provData.episodes === 'object') {
                    for (let catKey in provData.episodes) {
                        const epList = provData.episodes[catKey];
                        
                        if (Array.isArray(epList)) {
                            const ep = epList.find(e => parseInt(e.number) === parseInt(epNumber));
                            
                            if (ep && ep.id) {
                                const isDub = catKey.toLowerCase().includes('dub');
                                const langLabel = isDub ? "DUB" : "SUB";
                                
                                dynamicConfigs.push({
                                    name: provKey.toLowerCase(),
                                    cat: catKey.toLowerCase(),
                                    id: ep.id,
                                    lang: langLabel
                                });
                            }
                        }
                    }
                }
            }
        }

        if (dynamicConfigs.length === 0) {
            return JSON.stringify({ type: "none" });
        }
        
        let streams = []; 
        let bestSubtitle = "";
        let bestSubtitleHeaders = {};
        let allSubtitles = [];

        const providersRequiringAnilistId = [
            "dune", "zoro", "arc", "kiwi", "telli", "bee", "bun", "nun", "ally", "hop"
        ];

        for (let config of dynamicConfigs) {
            let prov = config.name;
            let cat = config.cat;
            let specificEpisodeId = config.id;
            let langLabel = config.lang;
            
            try {
                let reqQuery = { 
                    episodeId: specificEpisodeId,
                    provider: prov, 
                    category: cat,
                    ttl: 86400
                };
                
                if (providersRequiringAnilistId.includes(prov)) {
                    reqQuery.anilistId = parseInt(anilistId);
                }

                const res = await makeSecureRequest("sources", reqQuery, watchReferer);
                if (!res || res._blocked_by_cloudflare) continue;

                let videoArray = res.sources || res.streams || [];
                let subArray = res.subtitles || [];

                if (!Array.isArray(videoArray) || videoArray.length === 0) {
                    const possibleKeys = [cat, 'sub', 'ssub', 'dub', 'hdub', 'hsub'];
                    for (let k of possibleKeys) {
                        if (res[k]) {
                            if (Array.isArray(res[k].streams) && res[k].streams.length > 0) {
                                videoArray = res[k].streams;
                                subArray = res[k].subtitles || subArray;
                                break;
                            } else if (Array.isArray(res[k].sources) && res[k].sources.length > 0) {
                                videoArray = res[k].sources;
                                subArray = res[k].subtitles || subArray;
                                break;
                            }
                        }
                    }
                }

                if (Array.isArray(videoArray) && videoArray.length > 0) {
                    for (let s of videoArray) {
                        if (!s.url) continue;

                        const urlLower = s.url.toLowerCase();
                        const isM3U8 = urlLower.includes('.m3u8') || s.type === 'hls';
                        if (!isM3U8) continue;

                        const ref = s.referer || BASE_URL + "/";
                        const label = s.quality || 'HLS';

                        let streamUrl = s.url;
                        if (streamUrl.includes("uwu.m3u8")) {
                            streamUrl = streamUrl.replace("/stream/", "/hls/").replace("uwu.m3u8", "owo.m3u8");
                        }

                        streams.push({
                            title: `Server ${prov.toUpperCase()} (${label}) [${langLabel}]`,
                            streamUrl: streamUrl,
                            headers: { "Referer": ref }
                        });
                    }
                }

                if (subArray && Array.isArray(subArray)) {
                    for (let sub of subArray) {
                        const subUrl = sub.url || sub.file || "";
                        if (!subUrl) continue;
                        const lang = (sub.language || sub.lang || sub.label || "").toLowerCase();

                        allSubtitles.push({
                            url: subUrl,
                            label: sub.label || sub.language || sub.lang || "Unknown",
                            kind: sub.kind || "captions",
                            headers: { "Referer": (subUrl.match(/https?:\/\/[^/]+/) || [BASE_URL])[0] + "/" }
                        });

                        if (lang.includes("eng") || lang.includes("english")) {
                            if (bestSubtitle === "" || !lang.includes("forced")) {
                                bestSubtitle = subUrl;
                                bestSubtitleHeaders = { "Referer": BASE_URL + "/" };
                            }
                        } else if (bestSubtitle === "") {
                            bestSubtitle = subUrl;
                            bestSubtitleHeaders = { "Referer": BASE_URL + "/" };
                        }
                    }
                }

            } catch (e) {
                failedLinks.push({ server_name: prov.toUpperCase(), reason: e.message });
            }
        }

        if (streams.length > 0) {
            return JSON.stringify({ 
                type: "servers", 
                streams: streams, 
                subtitles: bestSubtitle, 
                subtitlesHeaders: bestSubtitleHeaders, 
                allSubtitles: allSubtitles 
            });
        } else {
            return JSON.stringify({ type: "none" });
        }
    } catch (error) {
        return JSON.stringify({ type: "none" });
    }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try { return await fetch(url, options); } catch(error) { return null; }
    }
}
