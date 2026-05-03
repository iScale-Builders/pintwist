"use strict";function recordPinObservation(a,b){try{let s=null;try{const p=new URL(location.href);if(p.pathname.startsWith("/search/"))s=p.searchParams.get("q")}catch{}chrome.runtime.sendMessage({action:"recordPinObservation",pin:{pin_id:a,saves:b.saves,reactions:b.reactions,shares:b.shares,repins:b.repins,comments:b.comments,pin_created_at:b.createdAt,image_url:b.imageUrl,is_video:b.isVideo,title:b.title,description:b.description,link:b.link,domain:b.domain,dominant_color:b.dominantColor,alt_text:b.altText,board_name:b.boardName,pinner_username:b.pinnerUsername},source_url:location.href,search_terms:s,seen_at:new Date().toISOString()},()=>{if(chrome.runtime.lastError){}})}catch{}}const CACHE_TTL=36e5,CONFIG={appVersion:null,experimentHash:null,handlerId:null,origin:"https://www.pinterest.com",path:"/",initialized:!1},State={metricsCache:new Map,loadedIDs:new Set,processingIDs:new Set,sortedPinIDs:new Set,insertedNodes:[],selectedMetric:"saves",count:0,timeout:null,observer:null,currentUrl:window.location.href,urlCheckInterval:null,aborted:!1,inFlightRequests:new Map,filterRanges:null,activeFilters:null};function getPinterestHeaderHeight(){const e=['[data-test-id="header"]','[data-test-id="header-container"]',"header",'[role="banner"]'];for(const t of e){const i=document.querySelector(t);if(i){const n=i.getBoundingClientRect();if(n.height>0)return n.height}}return 56}function getPinterestSidebarWidth(){const e=['[data-test-id="left-nav-container"]',"nav[aria-label]",'div[data-test-id="sidenav"]'];for(const t of e){const i=document.querySelector(t);if(i){const n=i.getBoundingClientRect();if(n.width>0&&n.width<120)return n.width}}return 60}const PINTWIST_BAR_HEIGHT=70;function applyContentOffset(){const e=document.querySelector('[data-test-id="masonry-container"]')?.closest("div")||document.querySelector("body > div:first-child");e&&e.id!=="pintwist-initial-bar"&&(e.style.marginTop=`${PINTWIST_BAR_HEIGHT}px`)}function removeContentOffset(){const e=document.querySelector('[data-test-id="masonry-container"]')?.closest("div")||document.querySelector("body > div:first-child");e&&e.id!=="pintwist-initial-bar"&&(e.style.marginTop="")}const ICONS={heart:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',reaction:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.061-1.061 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clip-rule="evenodd"/></svg>',share:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',repin:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 9v4H6V9H4v6h6v5l6-5h4V9h-2z"/><path d="M6 15v-4h12v4h2V9h-6l-6 5v1H6z"/></svg>',comment:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>',calendar:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/></svg>',download:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>'},METRIC_MAP={saves:"saves",share:"shares",reaction:"reactions",repin:"repins",comment:"comments"},sleep=e=>new Promise(t=>setTimeout(t,e));function escapeAttr(e){return e?String(e).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;"):""}function formatNumber(e){if(e>=1e6){const t=(e/1e6).toFixed(1);return(t.endsWith(".0")?t.slice(0,-2):t)+"M"}if(e>=1e3){const t=(e/1e3).toFixed(1);return(t.endsWith(".0")?t.slice(0,-2):t)+"K"}return e.toString()}function formatDate(e){try{return new Date(e).toLocaleDateString("en-US",{weekday:"short",year:"numeric",month:"short",day:"numeric"})}catch{return"Unknown"}}function getDaysAgo(e){try{const t=Math.floor((Date.now()-new Date(e))/864e5);return t===0?"TODAY":t===1?"YESTERDAY":t<7?`${t}D`:t<30?`${Math.floor(t/7)}W`:t<365?`${Math.floor(t/30)}MO`:`${Math.floor(t/365)}Y`}catch{return"UNKNOWN"}}function extractConfig(){if(CONFIG.initialized)return CONFIG;try{const e=document.querySelector("#__PWS_DATA__");if(e){const t=JSON.parse(e.textContent||"{}");CONFIG.appVersion=t.appVersion||"c7cbc61",CONFIG.experimentHash=t.context?.experiment_hash||"",CONFIG.handlerId=t.initialHandlerId||"www/index.js",CONFIG.path=t.context?.path||"/",CONFIG.origin=t.context?.origin||"https://www.pinterest.com"}}catch{CONFIG.appVersion="c7cbc61",CONFIG.experimentHash="",CONFIG.handlerId="www/index.js"}return CONFIG.initialized=!0,CONFIG}function getFreshConfig(){return CONFIG.initialized||extractConfig(),{appVersion:CONFIG.appVersion,experimentHash:CONFIG.experimentHash,handlerId:CONFIG.handlerId,path:window.location.pathname||CONFIG.path,origin:window.location.origin||CONFIG.origin}}function getCsrfToken(){const e=document.cookie.match(/csrftoken=([^;]+)/);return e?e[1]:null}async function saveCache(){try{if(!chrome?.storage?.local)return;const e=2e3;if(State.metricsCache.size>e){const t=[...State.metricsCache.entries()];t.slice(0,t.length-e).forEach(([i])=>State.metricsCache.delete(i))}await chrome.storage.local.set({pintwist_cache:Object.fromEntries(State.metricsCache)})}catch(e){console.warn("PinTwist: Cache save failed",e)}}async function loadCache(){try{const{pintwist_cache:e}=await chrome.storage.local.get("pintwist_cache");e&&(State.metricsCache=new Map(Object.entries(e)),console.log(`PinTwist: Loaded ${State.metricsCache.size} cached pins`))}catch(e){console.warn("PinTwist: Cache load failed",e)}}function getCached(e){const t=State.metricsCache.get(e);return t&&typeof t.timestamp=="number"&&Date.now()-t.timestamp<36e5?t:(t&&State.metricsCache.delete(e),null)}function setCache(e,t){t.timestamp=Date.now(),State.metricsCache.set(e,t),State.loadedIDs.add(e),State.metricsCache.size%20===0&&saveCache()}async function fetchBulk(e){if(!e.length)return new Map;const t=new Map,i=[];if(e.forEach(r=>{const m=getCached(r);m?t.set(r,m):i.push(r)}),!i.length)return t;const n=35,s=40,a=2;for(let r=0;r<i.length;r+=n){const o=i.slice(r,r+n).map(async l=>{for(let d=0;d<=a;d++){try{const h=await chrome.runtime.sendMessage({action:"fetchPinData",pinID:l,config:getFreshConfig(),csrfToken:getCsrfToken()});if(h?.success&&h.data){const f=extractMetrics(h.data,l);return setCache(l,f),{pinID:l,metrics:f}}}catch{if(d<a){await sleep(1e3);continue}}break}return null});(await Promise.all(o)).forEach(l=>{l&&t.set(l.pinID,l.metrics)}),r+n<i.length&&await sleep(s)}return t}async function fetchSingle(e){const t=getCached(e);if(t)return t;if(State.inFlightRequests.has(e))return State.inFlightRequests.get(e);const i=(async()=>{try{for(let s=0;s<=2;s++)try{const a=await chrome.runtime.sendMessage({action:"fetchPinData",pinID:e,config:getFreshConfig(),csrfToken:getCsrfToken()});if(a?.success&&a.data){const r=extractMetrics(a.data,e);return setCache(e,r),r}}catch(a){if(s<2){await sleep(1e3);continue}console.error(`PinTwist: Fetch failed for ${e} after 3 attempts`,a)}return null}finally{State.inFlightRequests.delete(e)}})();return State.inFlightRequests.set(e,i),i}function extractMetrics(e,t){if(!e)return{pinID:t,saves:0,reactions:0,shares:0,repins:0,comments:0,createdAt:null,imageUrl:null,isVideo:!1,title:null,description:null,link:null,domain:null,dominantColor:null,altText:null,boardName:null,pinnerUsername:null,fetchFailed:!0};const i=!!(e?.videos||e?.story_pin_data?.pages?.[0]?.blocks?.[0]?.video||e?.is_video);let n=null;if(e?.images&&(n=e.images.orig?.url||e.images["1200x"]?.url||e.images["736x"]?.url||e.images["564x"]?.url||e.images["474x"]?.url||e.images["236x"]?.url||Object.values(e.images).find(s=>s?.url)?.url),!n&&e?.videos?.video_list){const s=e.videos.video_list;for(const a of Object.keys(s))if(s[a]?.thumbnail){n=s[a].thumbnail;break}}if(!n&&e?.story_pin_data?.pages)for(const s of e.story_pin_data.pages){if(s?.image?.images){const a=s.image.images;if(n=a.orig?.url||a["1200x"]?.url||Object.values(a).find(r=>r?.url)?.url,n)break}if(s?.blocks)for(const a of s.blocks){if(a?.image?.images){const r=a.image.images;if(n=r.orig?.url||Object.values(r).find(m=>m?.url)?.url,n)break}if(a?.video?.video_list){for(const r of Object.values(a.video.video_list))if(r?.thumbnail){n=r.thumbnail;break}}}if(n)break}if(!n&&e?.carousel_data?.carousel_slots){for(const s of e.carousel_data.carousel_slots)if(s?.images&&(n=s.images.orig?.url||Object.values(s.images).find(a=>a?.url)?.url,n))break}if(!n&&e?.closeup_unified_description?.images){const s=e.closeup_unified_description.images;n=s.orig?.url||Object.values(s).find(a=>a?.url)?.url}return!n&&e?.image_signature&&(n=`https://i.pinimg.com/originals/${e.image_signature.slice(0,2)}/${e.image_signature.slice(2,4)}/${e.image_signature.slice(4,6)}/${e.image_signature}.jpg`),n||(n=e?.image_url||e?.imageUrl||e?.image_medium_url),{pinID:t,saves:e?.aggregated_pin_data?.aggregated_stats?.saves||0,reactions:e?.reaction_counts?.[1]||0,shares:e?.share_count||0,repins:e?.repin_count||0,comments:e?.aggregated_pin_data?.comment_count||0,createdAt:e?.created_at||null,imageUrl:n,isVideo:i,title:e?.title||e?.grid_title||null,description:e?.description||null,link:e?.link||null,domain:e?.domain||null,dominantColor:e?.dominant_color||null,altText:e?.auto_alt_text||null,boardName:e?.board?.name||null,pinnerUsername:e?.pinner?.username||null,fetchFailed:!1}}function createOverlayHTML(e){const t=e.createdAt?formatDate(e.createdAt):"Unknown",i=e.createdAt?getDaysAgo(e.createdAt):"",n=e.imageUrl?.startsWith("https://")?e.imageUrl:"";return`
        <div class="pintwist-metrics-overlay" data-pintwist="overlay">
            <div class="pintwist-metrics-column">
                <div class="pintwist-metric-item" title="Saves">
                    <div class="pintwist-metric-icon">${ICONS.heart}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.saves)}</span>
                </div>
                <div class="pintwist-metric-item" title="Reactions">
                    <div class="pintwist-metric-icon">${ICONS.reaction}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.reactions)}</span>
                </div>
                <div class="pintwist-metric-item" title="Shares">
                    <div class="pintwist-metric-icon">${ICONS.share}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.shares)}</span>
                </div>
                <div class="pintwist-metric-item" title="Repins">
                    <div class="pintwist-metric-icon">${ICONS.repin}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.repins)}</span>
                </div>
                <div class="pintwist-metric-item" title="Comments">
                    <div class="pintwist-metric-icon">${ICONS.comment}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.comments)}</span>
                </div>
                <div class="pintwist-metric-item" title="${escapeAttr(t)}">
                    <div class="pintwist-metric-icon">${ICONS.calendar}</div>
                    <span class="pintwist-metric-value">${i}</span>
                </div>
            </div>
            <button class="pintwist-download-btn" data-pin-id="${escapeAttr(e.pinID)}" data-image-url="${escapeAttr(n)}">
                <span class="pintwist-download-icon">${ICONS.download}</span>
                <span class="pintwist-download-text">Download</span>
                <span class="pintwist-download-loader" style="display:none;">\u23F3</span>
            </button>
        </div>
    `}function createLoadingHTML(){return`
        <div class="pintwist-metrics-overlay pintwist-loading-state" data-pintwist="placeholder">
            <div class="pintwist-metrics-column">
                ${[...Array(6)].map(()=>`
                    <div class="pintwist-metric-item pintwist-skeleton">
                        <div class="pintwist-metric-icon pintwist-skeleton-icon"></div>
                        <span class="pintwist-metric-value pintwist-skeleton-text"></span>
                    </div>
                `).join("")}
            </div>
        </div>
    `}function downloadImage(e,t,i){if(!t)return;const n=i.querySelector(".pintwist-download-text"),s=i.querySelector(".pintwist-download-loader"),a=i.querySelector(".pintwist-download-icon");n&&(n.style.display="none"),a&&(a.style.display="none"),s&&(s.style.display="inline"),i.disabled=!0,chrome.runtime.sendMessage({action:"downloadImage",url:t,filename:`pinterest_${e}_${Date.now()}`},()=>{setTimeout(()=>{n&&(n.style.display="inline"),a&&(a.style.display="inline"),s&&(s.style.display="none"),i.disabled=!1},1500)})}async function processPinsBulk(e){const t=[];if(e.forEach(n=>{if(n.querySelector('[data-pintwist="overlay"]'))return;const s=n.getAttribute("data-test-pin-id");!s||State.processingIDs.has(s)||(State.processingIDs.add(s),n.insertAdjacentHTML("beforeend",createLoadingHTML()),t.push({pinID:s,element:n}))}),!t.length)return;const i=await fetchBulk(t.map(n=>n.pinID));t.forEach(({pinID:n,element:s})=>{const a=s.querySelector('[data-pintwist="placeholder"]');a&&a.remove();const r=i.get(n);if(r){s.insertAdjacentHTML("beforeend",createOverlayHTML(r));recordPinObservation(n,r);const m=s.querySelector(".pintwist-download-btn");m&&m.addEventListener("click",o=>{o.preventDefault(),o.stopPropagation(),downloadImage(n,m.dataset.imageUrl,m)})}State.processingIDs.delete(n)})}function initObserver(){State.observer&&State.observer.disconnect();let e=[],t=null;State.observer=new MutationObserver(n=>{n.forEach(s=>{s.addedNodes.forEach(a=>{a.nodeType===1&&(a.hasAttribute?.("data-test-pin-id")&&e.push(a),a.querySelectorAll&&e.push(...a.querySelectorAll("[data-test-pin-id]")))})}),e.length&&(clearTimeout(t),t=setTimeout(()=>{const s=[...new Set(e)];e=[],s.length&&processPinsBulk(s)},100))});const i=document.querySelector('[data-test-id="masonry-container"]');i?State.observer.observe(i,{childList:!0,subtree:!0}):setTimeout(initObserver,2e3)}function processExisting(){const e=document.querySelectorAll("[data-test-pin-id]");console.log(`PinTwist: Found ${e.length} existing pins to process`),processPinsBulk(Array.from(e)),setTimeout(()=>{const t=document.querySelectorAll("[data-test-pin-id]");console.log(`PinTwist: Retry found ${t.length} total pins`),processPinsBulk(Array.from(t))},2e3)}async function waitForNewPins(e){let s=e,a=0,r=0;for(;r<5e3;){await sleep(250),r+=250;const o=document.querySelectorAll("[data-test-pin-id]").length;if(o>e)if(o===s){if(a+=250,a>=400)return!0}else a=0,s=o}return document.querySelectorAll("[data-test-pin-id]").length>e}window.sort_all=async function(){document.getElementById("sort-panel")?.remove(),document.getElementById("pintwist-initial-bar")?.remove(),document.getElementById("pintwist-sorted-container")?.remove(),State.aborted=!1;const e=await new Promise(o=>{chrome.storage.sync.get(["pintwist_theme_color"],p=>{o(p.pintwist_theme_color||"#F48FB1")})}),t=document.createElement("div");t.id="pintwist-initial-bar";const i=getPinterestHeaderHeight(),n=getPinterestSidebarWidth(),s=window.location.hostname.includes("trends.pinterest");let a,r;const m=15;s?(a=m,r=Math.round(window.innerWidth*.2)):(a=n+m,r=m),t.style.cssText=`
        position: fixed !important;
        top: ${s?12:i}px !important;
        left: ${a}px !important;
        right: ${r}px !important;
        z-index: 999999 !important;
        background: #F8F8F8 !important;
        border: 2px solid ${e} !important;
        border-radius: 50px !important;
        padding: 8px 20px !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-sizing: border-box !important;
    `,t.innerHTML=`
        <div class="pintwist-logo-container" style="display:flex; align-items:center; height:36px; margin:0;">
            <svg class="pintwist-logo-wordmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" style="height:28px; width:auto;">
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="2053.71" y="387.10" width="126.24" height="87.08" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="700.59" y="549.46" width="125.48" height="445.12" rx="0.53"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="2054.54" y="549.45" width="125.40" height="445.12" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
            </svg>
        </div>
        
        <label class="pintwist-sort-label" style="height:36px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Sort by:</label>
        <div class="custom-dropdown" id="pintwist-initial-dropdown-wrapper" style="display:flex; align-items:center; width:auto; min-width:120px; height:36px; margin:0;">
            <button class="custom-dropdown-btn" id="pintwist-initial-dropdown-btn" type="button" style="height:36px; display:flex; align-items:center; padding:0 12px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; gap:8px; box-sizing:border-box; cursor:pointer; margin:0;">
                <span class="dropdown-text">Saves</span>
                <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0;">
                    <path d="M6 9L1 4h10z"/>
                </svg>
            </button>
            <div class="custom-dropdown-menu" id="pintwist-initial-dropdown-menu">
                <div class="dropdown-item" data-value="saves">Saves</div>
                <div class="dropdown-item" data-value="share">Shares</div>
                <div class="dropdown-item" data-value="reaction">Reactions</div>
                <div class="dropdown-item" data-value="repin">Repins</div>
                <div class="dropdown-item" data-value="comment">Comments</div>
                <div class="dropdown-item" data-value="date">Date</div>
            </div>
        </div>
        <input type="hidden" id="pintwist-initial-sort-option" value="saves">
        
        <label class="pintwist-pages-label" style="height:36px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Pages to load:</label>
        <input type="number" id="pintwist-pages-input" class="pintwist-pages-input" value="4" min="1" max="50" style="height:36px; width:55px; padding:0 10px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; text-align:center; box-sizing:border-box; margin:0;">
        
        <button id="pintwist-sort-pins-btn" class="pintwist-sort-btn" style="height:36px; display:flex; align-items:center; justify-content:center; padding:0 20px; background:${e}; color:#FFF; border:none; border-radius:6px; font-weight:700; font-size:12px; cursor:pointer; text-transform:uppercase; box-sizing:border-box; margin:0;">SORT PINS</button>
        
        <div class="pintwist-search-wrapper" style="display:flex; align-items:center; height:36px; margin:0;">
            <input type="text" id="pintwist-search-input-initial" placeholder="Search Pinterest..." style="height:36px; padding:0 12px; border:1.5px solid #DDD; border-right:none; border-radius:16px 0 0 16px; font-size:12px; width:140px; background:#FFF; color:#555; box-sizing:border-box; margin:0;">
            <button id="pintwist-search-btn-initial" style="height:36px; padding:0 12px; border:1.5px solid #DDD; border-left:none; border-radius:0 16px 16px 0; background:#F0F0F0; color:#666; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; box-sizing:border-box; margin:0;">\u{1F50D}</button>
        </div>
        
        <label class="pintwist-checkbox-wrapper" style="display:flex; align-items:center; height:36px; gap:6px; cursor:pointer; margin:0;">
            <input type="checkbox" id="pintwist-show-overlays" checked style="width:16px; height:16px; accent-color:${e}; margin:0;">
            <span class="pintwist-checkbox-label" style="color:#555; font-size:12px; font-weight:600;">Show Overlays</span>
        </label>
        
        <a href="https://www.youtube.com/@iscalepod" target="_blank" class="pintwist-tutorial-link" style="height:36px; display:flex; align-items:center; padding:0 12px; background:#EFEFEF; color:#777; font-size:11px; font-weight:600; text-decoration:none; border-radius:4px; margin-left:auto; box-sizing:border-box;">Tutorial: youtube.com/@iscalepod</a>
    `,document.body.appendChild(t),setupInitialBarEvents(t),applyContentOffset()};function toggleOverlays(e){document.querySelectorAll(".pintwist-metrics-overlay").forEach(i=>{i.style.display=e?"":"none"})}function adjustPinterestPadding(){const e=window.location.pathname.includes("/pin/"),t=document.querySelector('[data-test-id="masonry-container"]'),i=document.querySelector('[data-test-id="pin-closeup-page"]');if(e&&(t||i)){const n=i||t;n.style.paddingTop="80px"}else t&&(t.style.paddingTop="")}function setupInitialBarEvents(e){const t=document.getElementById("pintwist-initial-dropdown-btn"),i=document.getElementById("pintwist-initial-dropdown-menu"),n=t.querySelector(".dropdown-text"),s=document.getElementById("pintwist-initial-sort-option");t.addEventListener("click",l=>{l.stopPropagation(),i.classList.toggle("show")}),i.querySelectorAll(".dropdown-item").forEach(l=>{l.addEventListener("click",d=>{s.value=d.target.dataset.value,n.textContent=d.target.textContent,i.classList.remove("show"),chrome.storage.local.set({sortOption:s.value})})}),document.addEventListener("click",l=>{t.contains(l.target)||i.classList.remove("show")});const a=document.getElementById("pintwist-search-input-initial"),r=document.getElementById("pintwist-search-btn-initial"),m=()=>{const l=a.value.trim();l&&(window.location.href=`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(l)}`)};r.addEventListener("click",m),a.addEventListener("keypress",l=>{l.key==="Enter"&&m()});const o=document.getElementById("pintwist-show-overlays");chrome.storage.sync.get(["pintwist_show_overlays"],l=>{const d=l.pintwist_show_overlays!==!1;o.checked=d,toggleOverlays(d)}),o.addEventListener("change",()=>{const l=o.checked;chrome.storage.sync.set({pintwist_show_overlays:l}),toggleOverlays(l)}),chrome.storage.sync.get(["pintwist_theme_color"],l=>{const d=l.pintwist_theme_color||"#F48FB1";applyThemeColor(d)}),document.getElementById("pintwist-sort-pins-btn").addEventListener("click",async()=>{const l=parseInt(document.getElementById("pintwist-pages-input").value)||4,d=document.getElementById("pintwist-initial-sort-option").value;State.pagesToLoad=l,State.selectedMetric=d,e.remove(),await startSortingProcess(l,d)})}async function startSortingProcess(e,t){try{const i=await new Promise(d=>{chrome.storage.sync.get(["pintwist_theme_color"],h=>{d(h.pintwist_theme_color||"#F48FB1")})}),n=adjustColorBrightness(i,40),s=document.createElement("div");s.id="pintwist-progress-panel",s.innerHTML=`
        <style>
            @keyframes pintwist-shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
        </style>
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%); 
                    padding: 40px 48px; border-radius: 24px; 
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.15), 0 10px 30px rgba(0,0,0,0.1);
                    z-index: 999999; min-width: 420px; border: 1px solid rgba(0, 0, 0, 0.05);">
            
            <div style="text-align: center; margin-bottom: 24px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" style="height: 50px; width: auto; margin-bottom: 8px;">
                    <path fill="${i}" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z M 2053.71 387.10 L 2179.95 387.10 A 0.34 0.34 0 0 1 2180.29 387.44 L 2180.29 473.84 A 0.34 0.34 0 0 1 2179.95 474.18 L 2053.71 474.18 A 0.34 0.34 0 0 1 2053.37 473.84 L 2053.37 387.44 A 0.34 0.34 0 0 1 2053.71 387.10 Z M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z M 700.59 549.46 L 826.07 549.46 A 0.53 0.53 0 0 1 826.60 549.99 L 826.60 994.05 A 0.53 0.53 0 0 1 826.07 994.58 L 700.59 994.58 A 0.53 0.53 0 0 1 700.06 994.05 L 700.06 549.99 A 0.53 0.53 0 0 1 700.59 549.46 Z M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z M 2054.54 549.45 L 2179.94 549.45 A 0.34 0.34 0 0 1 2180.28 549.79 L 2180.28 994.23 A 0.34 0.34 0 0 1 2179.94 994.57 L 2054.54 994.57 A 0.34 0.34 0 0 1 2054.20 994.23 L 2054.20 549.79 A 0.34 0.34 0 0 1 2054.54 549.45 Z M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
                </svg>
                <div style="color: #888; font-weight: 600; font-size: 16px; letter-spacing: 0.5px;">
                    Loading...
                </div>
            </div>
            
            <div id="pintwist-progress-info" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 0 4px;">
                <div style="font-size: 18px; font-weight: 700; color: #888;">
                    Page <span id="pintwist-progress-current" style="color: ${i};">0</span> 
                    <span style="color: #999; font-weight: 500;">of</span> 
                    <span id="pintwist-progress-total" style="color: ${i};">${e}</span>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: ${i};">
                    <span id="pintwist-progress-pct">0</span>%
                </div>
            </div>
            
            <div style="background: linear-gradient(90deg, #f5f5f5 0%, #eeeeee 100%); height: 8px; border-radius: 4px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                <div id="pintwist-progress-bar" style="
                    background: linear-gradient(90deg, ${i} 0%, ${n} 25%, ${i} 50%, ${n} 75%, ${i} 100%);
                    background-size: 200% 100%;
                    animation: pintwist-shimmer 1.5s linear infinite;
                    height: 100%; 
                    width: 0%; 
                    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); 
                    border-radius: 4px;
                "></div>
            </div>
            
            <div id="pintwist-progress-status" style="margin-top: 20px; text-align: center; font-size: 13px; color: #888; font-weight: 500; letter-spacing: 0.2px;">
                Initializing...
            </div>
            <div style="margin-top: 20px; text-align: center;">
                <button id="pintwist-progress-cancel" type="button" style="
                    background: ${i}; color: #fff; border: none;
                    padding: 8px 22px; border-radius: 8px;
                    font-size: 13px; font-weight: 600; cursor: pointer;
                    transition: background 0.15s ease, transform 0.1s ease;
                "
                onmouseover="this.style.background='${adjustColorBrightness(i,-20)}'"
                onmouseout="if(!this.disabled)this.style.background='${i}'"
                >Cancel scan</button>
            </div>
        </div>
    `,document.body.appendChild(s),State.selectedMetric=t,State.sortedPinIDs.clear(),State.insertedNodes=[],State.count=0,State.aborted=!1;document.getElementById("pintwist-progress-cancel").addEventListener("click",()=>{State.aborted=!0;const _b=document.getElementById("pintwist-progress-cancel");if(_b){_b.disabled=!0;_b.textContent="Cancelling…";_b.style.background="#999";_b.style.cursor="wait"}});const a=document.getElementById("pintwist-progress-bar"),r=document.getElementById("pintwist-progress-current"),m=document.getElementById("pintwist-progress-pct"),o=document.getElementById("pintwist-progress-status"),p=e;let l=0;for(let d=1;d<=p;d++){if(State.aborted){o.textContent="Cancelled",setTimeout(()=>s.remove(),2e3);return}r.textContent=d,m.textContent=Math.round(d/p*100),a.style.width=`${d/p*100}%`,o.textContent=`Page ${d}: Scanning...`;const h=document.querySelectorAll("[data-test-pin-id]"),f=Array.from(h).filter(c=>{const u=c.getAttribute("data-test-pin-id");return u&&!State.sortedPinIDs.has(u)});if(f.length>0){l=0,o.textContent=`Page ${d}: Fetching ${f.length} pins...`;const c=f.map(g=>g.getAttribute("data-test-pin-id")),u=await fetchBulk(c);for(const g of f){const w=g.getAttribute("data-test-pin-id");if(State.sortedPinIDs.has(w))continue;State.sortedPinIDs.add(w);const v=u.get(w);if(!v)continue;let y,x;State.selectedMetric==="date"?(y=new Date(v.createdAt).getTime()||0,x=new Date(v.createdAt).toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})):(y=v[METRIC_MAP[State.selectedMetric]]||0,x=formatNumber(y)),g.setAttribute("rel",y),g.dataset.pinId=w,g.classList.add("pinbox"),g.insertAdjacentHTML("beforeend",createOverlayHTML(v)),recordPinObservation(w,v);const b=g.closest('[data-grid-item="true"]')?.cloneNode(!0);b&&State.insertedNodes.push(b),State.count++}o.textContent=`Page ${d}: Done! (${f.length} pins processed)`}else if(l++,o.textContent=`Page ${d}: No new pins found`,l>=2){o.textContent="No more new pins found - stopping early";break}d<p&&(window.scrollTo(0,document.body.scrollHeight),await sleep(2500))}o.textContent="Building sorted view...",await sleep(500),s.remove(),showSortedBar()}catch(i){console.error("PinTwist: Error in startSortingProcess:",i),alert("PinTwist Error: "+i.message+`

Please refresh the page and try again.`),document.getElementById("pintwist-progress-panel")?.remove()}}function showSortedBar(){finishSort()}function finishSort(){const e=document.createElement("div");e.id="newgrid";const t=document.querySelectorAll('div[data-grid-item="true"]');if(t.length){const o=t[0].parentElement;o.before(e),o.remove()}const i=document.createElement("div");State.insertedNodes.forEach(o=>i.appendChild(o)),e.appendChild(i);const n=Array.from(e.querySelectorAll(".pinbox"));n.forEach(o=>{const p=o.dataset.pinId;if(!p)return;o.querySelectorAll("[data-pintwist]").forEach(d=>d.remove());const l=getCached(p);l&&(o.insertAdjacentHTML("beforeend",createOverlayHTML(l)),recordPinObservation(p,l))}),n.sort((o,p)=>(parseInt(p.getAttribute("rel"))||0)-(parseInt(o.getAttribute("rel"))||0)),e.innerHTML="";const a=`
        <div id="pintwist-resort-bar">
            <div class="pintwist-logo-container">
                <svg class="pintwist-logo-wordmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" height="28">
                    <path class="pintwist-themed-fill" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z"/>
                    <path class="pintwist-themed-fill" d="M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z"/>
                    <rect class="pintwist-themed-fill" x="2053.71" y="387.10" width="126.24" height="87.08" rx="0.34"/>
                    <path class="pintwist-themed-fill" d="M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z"/>
                    <path class="pintwist-themed-fill" d="M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z"/>
                    <path class="pintwist-themed-fill" d="M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z"/>
                    <rect class="pintwist-themed-fill" x="700.59" y="549.46" width="125.48" height="445.12" rx="0.53"/>
                    <path class="pintwist-themed-fill" d="M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z"/>
                    <rect class="pintwist-themed-fill" x="2054.54" y="549.45" width="125.40" height="445.12" rx="0.34"/>
                    <path class="pintwist-themed-fill" d="M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
                </svg>
            </div>
            <label>Re-sort by:</label>
            <div class="custom-dropdown" id="resort-dropdown-wrapper" style="width:auto; min-width:150px">
                <button class="custom-dropdown-btn" id="resort-dropdown-btn" type="button">
                    <span class="dropdown-text">${State.selectedMetric.charAt(0).toUpperCase()+State.selectedMetric.slice(1)}</span>
                    <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L1 4h10z"/>
                    </svg>
                </button>
                <div class="custom-dropdown-menu" id="resort-dropdown-menu">
                    <div class="dropdown-item" data-value="saves">Saves</div>
                    <div class="dropdown-item" data-value="reaction">Reactions</div>
                    <div class="dropdown-item" data-value="share">Shares</div>
                    <div class="dropdown-item" data-value="repin">Repins</div>
                    <div class="dropdown-item" data-value="comment">Comments</div>
                    <div class="dropdown-item" data-value="date">Date</div>
                </div>
            </div>
            <input type="hidden" id="pintwist-resort-select" value="${State.selectedMetric}">
            <div class="pintwist-search-wrapper">
                <input type="text" id="pintwist-search-input" placeholder="Search Pinterest..." />
                <button id="pintwist-search-btn">\u{1F50D}</button>
            </div>
            <label class="pintwist-checkbox-wrapper">
                <input type="checkbox" id="pintwist-show-badges" checked>
                <span class="pintwist-checkbox-label">Show Badges</span>
            </label>
            <button id="pintwist-filter-toggle">\u25BC Filters</button>
            <span class="resort-info" id="pintwist-match-count"><svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${n.length} PINS SORTED BY PINTWIST</span>
            <a href="https://www.youtube.com/@iscalepod" target="_blank" class="pintwist-tutorial-link">Tutorial: youtube.com/@iscalepod</a>
        </div>
    `;calculateFilterRanges(n);const r=`
        <div id="pintwist-filter-bar" class="pintwist-filter-expanded">
            <div class="filter-row">
                <button id="pintwist-reset-all-filters" class="reset-all-btn" title="Clear all filters">X ALL</button>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Saves:</label>
                        <input type="text" id="filter-saves-min" class="filter-input" data-metric="saves" data-bound="min" value="${State.filterRanges.saves.min}">
                        <span class="filter-dash">\u2014</span>
                        <input type="text" id="filter-saves-max" class="filter-input" data-metric="saves" data-bound="max" value="${State.filterRanges.saves.max}">
                        <div class="filter-pills-container" data-metric="saves"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Comments:</label>
                        <input type="text" id="filter-comments-min" class="filter-input" data-metric="comments" data-bound="min" value="${State.filterRanges.comments.min}">
                        <span class="filter-dash">\u2014</span>
                        <input type="text" id="filter-comments-max" class="filter-input" data-metric="comments" data-bound="max" value="${State.filterRanges.comments.max}">
                        <div class="filter-pills-container" data-metric="comments"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Repins:</label>
                        <input type="text" id="filter-repins-min" class="filter-input" data-metric="repins" data-bound="min" value="${State.filterRanges.repins.min}">
                        <span class="filter-dash">\u2014</span>
                        <input type="text" id="filter-repins-max" class="filter-input" data-metric="repins" data-bound="max" value="${State.filterRanges.repins.max}">
                        <div class="filter-pills-container" data-metric="repins"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Reactions:</label>
                        <input type="text" id="filter-reactions-min" class="filter-input" data-metric="reactions" data-bound="min" value="${State.filterRanges.reactions.min}">
                        <span class="filter-dash">\u2014</span>
                        <input type="text" id="filter-reactions-max" class="filter-input" data-metric="reactions" data-bound="max" value="${State.filterRanges.reactions.max}">
                        <div class="filter-pills-container" data-metric="reactions"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Shares:</label>
                        <input type="text" id="filter-shares-min" class="filter-input" data-metric="shares" data-bound="min" value="${State.filterRanges.shares.min}">
                        <span class="filter-dash">\u2014</span>
                        <input type="text" id="filter-shares-max" class="filter-input" data-metric="shares" data-bound="max" value="${State.filterRanges.shares.max}">
                        <div class="filter-pills-container" data-metric="shares"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper filter-date">
                    <div class="filter-group">
                        <label>Date:</label>
                        <input type="date" id="filter-date-min" class="filter-input" data-metric="date" data-bound="min" value="${new Date(State.filterRanges.date.min).toISOString().split("T")[0]}">
                        <span class="filter-dash">\u2014</span>
                        <input type="date" id="filter-date-max" class="filter-input" data-metric="date" data-bound="max" value="${new Date(State.filterRanges.date.max).toISOString().split("T")[0]}">
                        <div class="filter-pills-container" data-metric="date"></div>
                    </div>
                </div>
            </div>
        </div>
    `;let m='<div class="pinterest--container" id="pintwist-sorted-container">';n.forEach(o=>{o.classList.add("pinterest--block");const p=o.dataset.pinId||o.getAttribute("data-test-pin-id"),l=p?getCached(p):null,d=!!o.querySelector("video");if(l?.isVideo||d){const c=o.querySelector("video"),u=c?.poster||c?.getAttribute("poster")||c?.getAttribute("data-poster")||l?.imageUrl||o.querySelector("img")?.src;if(u){const g=o.querySelector("[data-pintwist]"),w=g?g.outerHTML:createOverlayHTML(l);let v=0,y="";State.selectedMetric==="date"?(v=l?.createdAt?new Date(l.createdAt).getTime():0,y=l?.createdAt?getDaysAgo(l.createdAt):"Unknown"):(v={saves:l?.saves,share:l?.shares,reaction:l?.reactions,repin:l?.repins,comment:l?.comments}[State.selectedMetric]||0,y=`${State.selectedMetric.charAt(0).toUpperCase()+State.selectedMetric.slice(1)}: ${formatNumber(v)}`),o.innerHTML="";const x=document.createElement("a");x.href=`https://www.pinterest.com/pin/${p}/`,x.target="_blank",x.style.cssText="display:block;text-decoration:none;";const b=document.createElement("img");b.src=u,b.alt="Video thumbnail",b.style.cssText="width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;",x.appendChild(b),o.appendChild(x);const C=document.createElement("div");C.className="pintwist-video-badge",C.textContent="\u25B6 Video",o.appendChild(C);const A=document.createElement("a");A.href=`/pin/${p}/`,A.target="_blank",A.className="pintwist-legacy-badge",A.textContent=y,A.dataset.pinId=p,o.appendChild(A),o.insertAdjacentHTML("beforeend",w),m+=o.outerHTML;return}}o.querySelectorAll("img").forEach(c=>{const u=c.getAttribute("data-src")||c.getAttribute("data-lazy-src")||c.getAttribute("loading-src");u&&!c.src&&(c.src=u);const g=c.getAttribute("srcset");if(g&&!c.src){const w=g.split(",").map(v=>v.trim().split(" ")[0]);w.length&&(c.src=w[w.length-1])}});let f=!1;if(o.querySelectorAll("img").forEach(c=>{const u=c.getAttribute("src")||c.src||"";u&&u.startsWith("http")&&(f=!0)}),f||o.querySelectorAll('div[style*="background"]').forEach(c=>{const g=(c.getAttribute("style")||"").match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/);if(g){const w=document.createElement("img");w.src=g[1],w.style.cssText="width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;",c.parentNode?.insertBefore(w,c),c.remove(),f=!0}}),!f&&l?.imageUrl){const c=document.createElement("img");c.src=l.imageUrl,c.alt="Pin thumbnail",c.style.cssText="width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;",o.insertBefore(c,o.firstChild),f=!0}if(!f){const c=document.createElement("div");c.className="pintwist-placeholder-thumb",c.innerHTML=`<span>\u{1F4CC}</span><span>Pin #${p?.slice(-6)||"?"}</span><a href="https://www.pinterest.com/pin/${p}/" target="_blank" class="pintwist-view-link">View on Pinterest</a>`,o.insertBefore(c,o.firstChild)}if(o.querySelectorAll('[style*="padding-bottom"]').forEach(c=>{c.style.paddingBottom="0"}),o.querySelectorAll("a").forEach(c=>{const u=c.querySelector('img, video, canvas, svg, [style*="background"]'),g=c.querySelector("div, span");!u&&!g&&c.textContent.trim().length>0&&!c.classList.contains("pintwist-download-btn")&&!c.classList.contains("pintwist-legacy-badge")&&c.remove()}),o.querySelectorAll('[data-test-id="pinTitle"], [data-test-id="pin-title"], [data-test-id="truncated-description"]').forEach(c=>c.remove()),o.querySelectorAll("button:not(.pintwist-download-btn)").forEach(c=>c.remove()),o.querySelectorAll('[role="button"]:not(.pintwist-download-btn)').forEach(c=>c.remove()),!o.querySelector(".pintwist-legacy-badge")){let c="";if(State.selectedMetric==="date")c=l?.createdAt?getDaysAgo(l.createdAt):"Unknown";else{const g={saves:l?.saves,share:l?.shares,reaction:l?.reactions,repin:l?.repins,comment:l?.comments}[State.selectedMetric]||0;c=`${State.selectedMetric.charAt(0).toUpperCase()+State.selectedMetric.slice(1)}: ${formatNumber(g)}`}const u=document.createElement("a");u.href=`/pin/${p}/`,u.target="_blank",u.className="pintwist-legacy-badge",u.textContent=c,u.dataset.pinId=p,o.appendChild(u)}m+=o.outerHTML}),m+="</div>",document.write(`<style>
        #pintwist-sorted-container div { padding-bottom: 0 !important; min-height: 0 !important; }
        #pintwist-sorted-container [style*="padding-bottom"] { padding-bottom: 0 !important; }
        .pinterest--block, .pinterest--block * { padding-bottom: 0 !important; }
    </style>${a}${r}${m}`),setTimeout(()=>{reattachListeners(),setupResortBar(),setupSearchBar(),setupFilterBar(),adjustPinterestPadding()},100),window.scrollTo(0,0),saveCache()}function reattachListeners(){document.querySelectorAll(".pintwist-download-btn").forEach(e=>{const t=e.cloneNode(!0);e.parentNode.replaceChild(t,e),t.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),downloadImage(t.dataset.pinId,t.dataset.imageUrl,t)})})}function toggleBadges(e){document.querySelectorAll(".pintwist-legacy-badge").forEach(i=>{i.style.display=e?"":"none"})}function applyThemeColor(e){const t=adjustColorBrightness(e,-20);document.documentElement.style.setProperty("--pintwist-primary",e),document.documentElement.style.setProperty("--pintwist-primary-dark",t),document.querySelectorAll(".pintwist-themed-fill").forEach(a=>{a.style.fill=e}),document.querySelectorAll(".pintwist-legacy-badge").forEach(a=>{a.classList.contains("pintwist-badge-grey")||(a.style.borderColor=e,a.style.color=e,a.style.background="rgba(255, 255, 255, 0.9)")});const i=document.getElementById("pintwist-resort-bar");i&&i.style.setProperty("border-color",e,"important");const n=document.getElementById("pintwist-filter-bar");n&&n.style.setProperty("border-color",e,"important");const s=document.getElementById("pintwist-initial-bar");if(s){s.style.setProperty("border-color",e,"important");const a=document.getElementById("pintwist-sort-pins-btn");a&&(a.style.background=e);const r=document.getElementById("pintwist-show-overlays");r&&(r.style.accentColor=e)}}function adjustColorBrightness(e,t){const i=parseInt(e.replace("#",""),16),n=Math.round(2.55*t),s=Math.max(0,Math.min(255,(i>>16)+n)),a=Math.max(0,Math.min(255,(i>>8&255)+n)),r=Math.max(0,Math.min(255,(i&255)+n));return"#"+(16777216+s*65536+a*256+r).toString(16).slice(1)}function setupResortBar(){const e=document.getElementById("resort-dropdown-btn"),t=document.getElementById("resort-dropdown-menu"),i=e?.querySelector(".dropdown-text"),n=document.getElementById("pintwist-resort-select");if(!e||!t)return;e.addEventListener("click",a=>{a.stopPropagation(),t.classList.toggle("show")}),t.querySelectorAll(".dropdown-item").forEach(a=>{a.addEventListener("click",r=>{n.value=r.target.dataset.value,i.textContent=r.target.textContent,t.classList.remove("show"),resortPins(r.target.dataset.value)})}),document.addEventListener("click",a=>{e.contains(a.target)||t.classList.remove("show")});const s=document.getElementById("pintwist-show-badges");s&&(chrome.storage.sync.get(["pintwist_show_badges"],a=>{const r=a.pintwist_show_badges!==!1;s.checked=r,toggleBadges(r)}),s.addEventListener("change",()=>{const a=s.checked;chrome.storage.sync.set({pintwist_show_badges:a}),toggleBadges(a)})),chrome.storage.sync.get(["pintwist_theme_color"],a=>{const r=a.pintwist_theme_color||"#F48FB1";applyThemeColor(r)})}function setupSearchBar(){const e=document.getElementById("pintwist-search-input"),t=document.getElementById("pintwist-search-btn");if(!e||!t)return;const i=()=>{const n=e.value.trim();n&&(window.location.href=`${window.location.origin}/search/pins/?q=${encodeURIComponent(n)}`)};t.addEventListener("click",i),e.addEventListener("keypress",n=>{n.key==="Enter"&&i()})}function resortPins(e){const t=document.getElementById("pintwist-sorted-container");if(!t)return;const i=Array.from(t.querySelectorAll(".pinterest--block"));i.forEach(s=>{const a=s.dataset.pinId||s.getAttribute("data-test-pin-id");if(!a)return;const r=getCached(a);if(!r)return;let m,o;e==="date"?(m=new Date(r.createdAt).getTime()||0,o=new Date(r.createdAt).toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})):(m={saves:r.saves,share:r.shares,reaction:r.reactions,repin:r.repins,comment:r.comments}[e]||0,o=`${e.charAt(0).toUpperCase()+e.slice(1)}: ${formatNumber(m)}`),s.setAttribute("rel",m);const p=s.querySelector(".pintwist-legacy-badge");p&&(p.textContent=o)}),i.sort((s,a)=>(parseInt(a.getAttribute("rel"))||0)-(parseInt(s.getAttribute("rel"))||0)),t.innerHTML="",i.forEach(s=>t.appendChild(s)),reattachListeners();const n=document.querySelector("#pintwist-resort-bar .resort-info");n&&(n.innerHTML=`<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${i.length} PINS SORTED BY PINTWIST`)}function calculateFilterRanges(e){const t=new Set;e.forEach(n=>{const s=n.dataset.pinId;s&&State.metricsCache.has(s)&&t.add(s)});const i={saves:{min:1/0,max:-1/0},comments:{min:1/0,max:-1/0},repins:{min:1/0,max:-1/0},reactions:{min:1/0,max:-1/0},shares:{min:1/0,max:-1/0},date:{min:1/0,max:-1/0}};for(const n of t){const s=State.metricsCache.get(n);if(i.saves.min=Math.min(i.saves.min,s.saves),i.saves.max=Math.max(i.saves.max,s.saves),i.comments.min=Math.min(i.comments.min,s.comments),i.comments.max=Math.max(i.comments.max,s.comments),i.repins.min=Math.min(i.repins.min,s.repins),i.repins.max=Math.max(i.repins.max,s.repins),i.reactions.min=Math.min(i.reactions.min,s.reactions),i.reactions.max=Math.max(i.reactions.max,s.reactions),i.shares.min=Math.min(i.shares.min,s.shares),i.shares.max=Math.max(i.shares.max,s.shares),s.createdAt){let a;if(typeof s.createdAt=="number"?a=s.createdAt:a=new Date(s.createdAt).getTime(),a&&!isNaN(a)){const m=new Date(new Date(a).toISOString().split("T")[0]).getTime();i.date.min=Math.min(i.date.min,m),i.date.max=Math.max(i.date.max,m)}}}if(i.date.min===1/0||i.date.max===-1/0){console.warn("PinTwist: No valid dates found in pins, using defaults");const n=new Date,s=new Date;s.setFullYear(n.getFullYear()-1),i.date.min=new Date(s.toISOString().split("T")[0]).getTime(),i.date.max=new Date(n.toISOString().split("T")[0]).getTime()}return State.filterRanges=i,State.activeFilters=JSON.parse(JSON.stringify(i)),i}function parseFilterValue(e){if(!e)return null;const t=e.toString().toUpperCase();return t.includes("M")?parseFloat(t)*1e6:t.includes("K")?parseFloat(t)*1e3:parseFloat(t)||0}function applyFilters(){const e=(p,l)=>{if(!p)return l;const h=new Date(p).getTime();return isNaN(h)?l:h},t={saves:{min:parseFilterValue(document.getElementById("filter-saves-min").value),max:parseFilterValue(document.getElementById("filter-saves-max").value)},comments:{min:parseFilterValue(document.getElementById("filter-comments-min").value),max:parseFilterValue(document.getElementById("filter-comments-max").value)},repins:{min:parseFilterValue(document.getElementById("filter-repins-min").value),max:parseFilterValue(document.getElementById("filter-repins-max").value)},reactions:{min:parseFilterValue(document.getElementById("filter-reactions-min").value),max:parseFilterValue(document.getElementById("filter-reactions-max").value)},shares:{min:parseFilterValue(document.getElementById("filter-shares-min").value),max:parseFilterValue(document.getElementById("filter-shares-max").value)},date:{min:e(document.getElementById("filter-date-min").value,0),max:e(document.getElementById("filter-date-max").value,Date.now())+86399999}};State.activeFilters=t;const i=document.getElementById("pintwist-sorted-container");if(!i)return;document.querySelector(".pintwist-filter-separator")?.remove();const n=Array.from(i.querySelectorAll(".pinterest--block")),s=[],a=[];n.forEach(p=>{const l=p.dataset.pinId,d=getCached(l);if(!d)return;const h=new Date(d.createdAt).getTime(),f=d.saves>=t.saves.min&&d.saves<=t.saves.max&&d.comments>=t.comments.min&&d.comments<=t.comments.max&&d.repins>=t.repins.min&&d.repins<=t.repins.max&&d.reactions>=t.reactions.min&&d.reactions<=t.reactions.max&&d.shares>=t.shares.min&&d.shares<=t.shares.max&&h>=t.date.min&&h<=t.date.max,c=p.querySelector(".pintwist-legacy-badge");f?(s.push(p),c&&c.classList.remove("pintwist-badge-grey")):(a.push(p),c&&c.classList.add("pintwist-badge-grey"))});const r=State.selectedMetric,m=(p,l)=>{const d=getCached(p.dataset.pinId),h=getCached(l.dataset.pinId);if(!d||!h)return 0;let f,c;if(r==="date")f=new Date(d.createdAt).getTime(),c=new Date(h.createdAt).getTime();else{const g={saves:"saves",comment:"comments",repin:"repins",reaction:"reactions",share:"shares"}[r];f=d[g]||0,c=h[g]||0}return c-f};if(s.sort(m),a.sort(m),i.innerHTML="",s.forEach(p=>i.appendChild(p)),a.length>0){const p=document.createElement("div");p.className="pintwist-filter-separator",p.innerHTML=`<span>Filtered Results (${a.length} pins)</span>`,i.appendChild(p),a.forEach(l=>i.appendChild(l))}const o=document.getElementById("pintwist-match-count");o&&(o.innerHTML=`<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${s.length}/${n.length} PINS SORTED BY PINTWIST`),reattachListeners(),chrome.storage.local.set({pintwist_active_filters:t}),updateActiveFiltersDisplay()}function resetFilters(){State.filterRanges&&(document.getElementById("filter-saves-min").value=State.filterRanges.saves.min,document.getElementById("filter-saves-max").value=State.filterRanges.saves.max,document.getElementById("filter-comments-min").value=State.filterRanges.comments.min,document.getElementById("filter-comments-max").value=State.filterRanges.comments.max,document.getElementById("filter-repins-min").value=State.filterRanges.repins.min,document.getElementById("filter-repins-max").value=State.filterRanges.repins.max,document.getElementById("filter-reactions-min").value=State.filterRanges.reactions.min,document.getElementById("filter-reactions-max").value=State.filterRanges.reactions.max,document.getElementById("filter-shares-min").value=State.filterRanges.shares.min,document.getElementById("filter-shares-max").value=State.filterRanges.shares.max,document.getElementById("filter-date-min").value=new Date(State.filterRanges.date.min).toISOString().split("T")[0],document.getElementById("filter-date-max").value=new Date(State.filterRanges.date.max).toISOString().split("T")[0],resizeAllFilterInputs(),applyFilters())}function resizeAllFilterInputs(){document.querySelectorAll(".filter-input").forEach(e=>{const i=(e.value||e.placeholder||"0").length,n=Math.max(40,Math.min(100,i*8+16));e.style.width=n+"px"})}function setupFilterBar(){const e=document.getElementById("pintwist-filter-toggle"),t=document.getElementById("pintwist-filter-bar"),i=document.getElementById("pintwist-reset-all-filters");let n=null;const s=r=>{const o=(r.value||r.placeholder||"0").length,p=Math.max(40,Math.min(100,o*8+16));r.style.width=p+"px"};document.querySelectorAll(".filter-input").forEach(r=>{s(r),r.addEventListener("input",m=>{s(m.target),clearTimeout(n),n=setTimeout(()=>{applyFilters()},1e3)}),r.addEventListener("keypress",m=>{m.key==="Enter"&&(clearTimeout(n),applyFilters())})}),e?.addEventListener("click",()=>{t.classList.toggle("pintwist-filter-expanded"),e.textContent=t.classList.contains("pintwist-filter-expanded")?"\u25BC Filters":"\u25B6 Filters"}),i?.addEventListener("click",resetFilters)}function updateActiveFiltersDisplay(){if(!State.filterRanges||!State.activeFilters)return;document.querySelectorAll(".filter-pills-container").forEach(n=>{n.innerHTML=""});const e=n=>{const s=document.getElementById(`filter-${n}-min`),a=document.getElementById(`filter-${n}-max`);if(!s||!a)return!1;if(n==="date"){const r=new Date(State.filterRanges.date.min).toISOString().split("T")[0],m=new Date(State.filterRanges.date.max).toISOString().split("T")[0],o=s.value&&s.value!==r,p=a.value&&a.value!==m;return o||p}else{const r=State.filterRanges[n].min,m=State.filterRanges[n].max,o=s.value.trim()?parseFilterValue(s.value):r,p=a.value.trim()?parseFilterValue(a.value):m;return o!==r||p!==m}},t=n=>{const s=document.querySelector(`.filter-pills-container[data-metric="${n}"]`);if(!s)return;const a=document.createElement("div");a.className="filter-pill filter-reset-pill",a.innerHTML=`
            <div class="filter-pill-remove">\xD7</div>
        `,s.appendChild(a),a.querySelector(".filter-pill-remove").addEventListener("click",r=>{r.stopPropagation(),resetMetricFilter(n)})};["saves","comments","repins","reactions","shares","date"].forEach(n=>{e(n)&&t(n)})}function resetMetricFilter(e){State.filterRanges&&(e==="date"?(document.getElementById(`filter-${e}-min`).value=new Date(State.filterRanges.date.min).toISOString().split("T")[0],document.getElementById(`filter-${e}-max`).value=new Date(State.filterRanges.date.max).toISOString().split("T")[0]):(document.getElementById(`filter-${e}-min`).value=State.filterRanges[e].min,document.getElementById(`filter-${e}-max`).value=State.filterRanges[e].max),resizeAllFilterInputs(),applyFilters())}function removeIndividualFilter(e,t){if(State.filterRanges){if(e==="date"){const i=`filter-${e}-${t}`,n=State.filterRanges[e][t],s=document.getElementById(i);s.value=new Date(n).toISOString().split("T")[0];const a=s.value||"0",r=Math.max(40,Math.min(100,a.length*8+16));s.style.width=r+"px"}else{const i=`filter-${e}-${t}`,n=State.filterRanges[e][t],s=document.getElementById(i);s.value=formatNumber(n);const a=s.value||"0",r=Math.max(40,Math.min(100,a.length*8+16));s.style.width=r+"px"}applyFilters()}}function startUrlMonitor(){window.addEventListener("popstate",handleUrlChange),window.addEventListener("hashchange",handleUrlChange),State.urlCheckInterval=setInterval(()=>{window.location.href!==State.currentUrl&&handleUrlChange()},2e3)}function handleUrlChange(){window.location.href!==State.currentUrl&&(State.aborted=!0,clearState(),State.currentUrl=window.location.href,State.currentUrl.includes("pinterest")&&setTimeout(init,1e3))}function clearState(){State.loadedIDs.clear(),State.processingIDs.clear(),State.sortedPinIDs.clear(),State.insertedNodes=[],State.count=0,State.timeout&&clearTimeout(State.timeout),State.observer&&(State.observer.disconnect(),State.observer=null)}chrome.runtime.onMessage.addListener((e,t,i)=>{if(location.href.includes("pinterest"))try{e.action==="enableBar"?document.getElementById("pintwist-initial-bar")||document.getElementById("pintwist-resort-bar")||sort_all():e.action==="disableBar"?hideBar():e.action==="showOverlays"?toggleOverlays(!0):e.action==="hideOverlays"?toggleOverlays(!1):e.action==="updateThemeColor"&&applyThemeColor(e.data)}catch(n){console.warn("PinTwist: Message handler error",n)}});function hideBar(){const e=document.getElementById("pintwist-initial-bar"),t=document.getElementById("pintwist-resort-bar"),i=document.getElementById("pintwist-filter-bar"),n=document.getElementById("newgrid");e&&e.remove(),t&&t.remove(),i&&i.remove(),n&&n.remove(),removeContentOffset(),State.aborted=!0}const AUTH_KEY="pintwist_auth";async function checkAuth(){try{if((await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY]?.signedIn)return!0}catch{}try{return(await chrome.runtime.sendMessage({type:"PINTWIST_CHECK_AUTH"}))?.signedIn===!0}catch{return!1}}let initHasRun=!1;chrome.storage.onChanged.addListener((e,t)=>{if(t!=="local"||!e[AUTH_KEY])return;e[AUTH_KEY].newValue?.signedIn?initHasRun||init():(initHasRun=!1,hideBar())});async function init(){if(!location.href.includes("pinterest"))return;if(console.log("PinTwist 1.5.3: Initializing..."),!await checkAuth()){console.log("PinTwist: Not authenticated. Sign in at iscalelabs.com to use PinTwist.");return}initHasRun=!0,extractConfig(),State.metricsCache.size||await loadCache(),State.urlCheckInterval||startUrlMonitor(),setTimeout(()=>{processExisting(),initObserver()},1500),chrome.storage.sync.get(["pintwist_enabled"],t=>{t.pintwist_enabled!==!1&&setTimeout(()=>{sort_all()},2e3)})}window.addEventListener("beforeunload",saveCache),document.readyState==="complete"||document.readyState==="interactive"?init():window.addEventListener("load",init);


// =====================================================================
// PINTWIST AUTOMATION (v1.7.0)
// Queue runner: paste comma/newline separated search terms, automatically
// search -> load N pages -> save CSV -> wait interval (jittered if randomize) ->
// next term. Captcha/rate-limit detected -> 1h cooldown.
// State persisted in chrome.storage.local["pintwist_queue"] so it survives
// the SPA page transitions Pinterest does between searches.
// =====================================================================
(function pintwistAutomation() {
  const QKEY = "pintwist_queue";
  const DEFAULTS = {
    running: false,
    terms: [],
    currentIdx: 0,
    pagesPerTerm: 40,
    intervalMin: 1,         // minutes (was intervalSec; migrated on load)
    randomize: false,
    randomizePct: 40,
    cooldownUntil: 0,
    lastNavAt: 0,
    panelExpanded: false,
  };
  // Module-local — survives across same-page renders, resets on navigation.
  let _pendingNextTimeout = null;
  let _pendingNextDeadline = 0;
  const COOLDOWN_MS = 60 * 60 * 1000;
  const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

  let state = null;

  async function loadState() {
    const out = await chrome.storage.local.get(QKEY);
    state = Object.assign({}, DEFAULTS, out[QKEY] || {});
    // Migrate legacy intervalSec → intervalMin
    if (typeof state.intervalSec === "number") {
      state.intervalMin = Math.max(0.25, Math.round((state.intervalSec / 60) * 4) / 4);
      delete state.intervalSec;
    }
    if (typeof state.intervalMin !== "number" || !isFinite(state.intervalMin)) {
      state.intervalMin = DEFAULTS.intervalMin;
    }
    // enabled is dropped — running is the single source of truth now
    delete state.enabled;
    return state;
  }
  async function saveState(patch) {
    state = Object.assign(state || {}, patch || {});
    await chrome.storage.local.set({ [QKEY]: state });
    renderPanel();
  }

  function parseTerms(raw) {
    if (!raw) return [];
    return raw.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
  }

  function searchUrlFor(term) {
    return "https://www.pinterest.com/search/pins/?q=" + encodeURIComponent(term);
  }

  function currentSearchTerm() {
    try {
      const u = new URL(location.href);
      if (!u.pathname.startsWith("/search/")) return null;
      return u.searchParams.get("q");
    } catch { return null; }
  }

  function isOnTermPage(idx) {
    if (!state.terms[idx]) return false;
    const cur = currentSearchTerm();
    if (!cur) return false;
    return cur.trim().toLowerCase() === state.terms[idx].term.trim().toLowerCase();
  }

  function jitterDelayMs() {
    const base = Math.max(0.25, state.intervalMin) * 60 * 1000;
    if (!state.randomize) return base;
    const pct = Math.max(0, Math.min(95, state.randomizePct)) / 100;
    const min = base * (1 - pct);
    const max = base * (1 + pct);
    return Math.floor(min + Math.random() * (max - min));
  }

  function looksLikeCaptcha() {
    const t = (document.title || "").toLowerCase();
    if (t.includes("security check") || t.includes("verify")) return true;
    if (document.querySelector('[data-test-id="captcha-form"]')) return true;
    const body = (document.body && document.body.innerText) || "";
    if (/checking your browser|unusual activity|verify you.{1,3}re a human/i.test(body.slice(0, 4000))) return true;
    return false;
  }

  async function triggerCooldown(reason) {
    const until = Date.now() + COOLDOWN_MS;
    await saveState({ cooldownUntil: until, running: false });
    console.warn("[PinTwist Automation] Cooldown:", reason, "until", new Date(until).toISOString());
    try { alert("PinTwist: " + reason + "\nQueue paused for 1 hour. Resume from the toolbar when ready."); } catch {}
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsvForCurrentScan(term) {
    const ids = Array.from(State.sortedPinIDs || []);
    const rows = [];
    const headers = [
      "search_term", "pin_id", "pin_url", "title", "description", "link", "domain",
      "board_name", "pinner_username", "dominant_color", "alt_text",
      "saves", "comments", "repins", "reactions", "shares",
      "pin_created_at", "image_url", "is_video", "scanned_at",
    ];
    rows.push(headers.join(","));
    const stamp = new Date().toISOString();
    for (const id of ids) {
      const m = State.metricsCache.get(id);
      if (!m) continue;
      rows.push([
        term, id, "https://www.pinterest.com/pin/" + id + "/",
        m.title, m.description, m.link, m.domain,
        m.boardName, m.pinnerUsername, m.dominantColor, m.altText,
        m.saves, m.comments, m.repins, m.reactions, m.shares,
        m.createdAt, m.imageUrl, m.isVideo, stamp,
      ].map(csvCell).join(","));
    }
    return { csv: rows.join("\r\n"), pinCount: ids.length };
  }

  function downloadCsvBlob(csv, filename) {
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (err) {
      console.error("[PinTwist Automation] CSV download failed:", err);
      return false;
    }
  }

  function waitFor(predicate, opts) {
    const o = opts || {};
    const timeoutMs = o.timeoutMs || 30000;
    const intervalMs = o.intervalMs || 250;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        try { if (predicate()) return resolve(true); } catch {}
        if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  async function runOnceForCurrentPage() {
    await loadState();
    if (!state.running) return;
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) return;
    if (state.currentIdx >= state.terms.length) return;

    const term = state.terms[state.currentIdx];
    if (!term || term.status === "done" || term.status === "failed" || term.status === "cancelled") {
      return advanceAndNavigate();
    }

    if (looksLikeCaptcha()) return triggerCooldown("Captcha / security check detected");

    if (!isOnTermPage(state.currentIdx)) {
      term.status = "running";
      term.startedAt = Date.now();
      state.terms[state.currentIdx] = term;
      await saveState({ lastNavAt: Date.now() });
      location.href = searchUrlFor(term.term);
      return;
    }

    try {
      await waitFor(() => document.getElementById("pintwist-initial-bar"), { timeoutMs: 30000 });
      const pagesInput = document.getElementById("pintwist-pages-input");
      const sortBtn = document.getElementById("pintwist-sort-pins-btn");
      if (!pagesInput || !sortBtn) throw new Error("toolbar inputs missing");
      pagesInput.value = String(state.pagesPerTerm);
      pagesInput.dispatchEvent(new Event("change", { bubbles: true }));
      sortBtn.click();

      let lastSize = -1, lastChange = Date.now();
      const start = Date.now();
      let cancelled = false;
      while (Date.now() - start < SCAN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 1000));
        // User clicked Cancel scan? — bail without cooldown, without saving CSV.
        if (typeof State !== "undefined" && State.aborted) { cancelled = true; break; }
        // Re-read queue state in case Pause/Clear was clicked from the panel.
        try {
          const live = (await chrome.storage.local.get(QKEY))[QKEY];
          if (!live || !live.running) { cancelled = true; break; }
        } catch {}
        const size = (window.State && window.State.sortedPinIDs && window.State.sortedPinIDs.size)
                  || (typeof State !== "undefined" && State.sortedPinIDs && State.sortedPinIDs.size) || 0;
        if (size !== lastSize) { lastSize = size; lastChange = Date.now(); }
        if (looksLikeCaptcha()) return triggerCooldown("Captcha during scan");
        if (lastSize > 0 && Date.now() - lastChange > 8000) break;
      }

      if (cancelled) {
        // Mark cancelled if not already marked, leave queue paused.
        if (state.terms[state.currentIdx] && state.terms[state.currentIdx].status !== "cancelled") {
          state.terms[state.currentIdx].status = "cancelled";
          state.terms[state.currentIdx].error = "user cancelled";
        }
        await saveState({ running: false });
        return;
      }

      if (lastSize === 0) return triggerCooldown("No pins loaded - likely rate-limited");

      const { csv, pinCount } = buildCsvForCurrentScan(term.term);
      const safe = term.term.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 60);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadCsvBlob(csv, "pintwist_" + safe + "_" + stamp + ".csv");

      term.status = "done";
      term.pinCount = pinCount;
      term.finishedAt = Date.now();
      state.terms[state.currentIdx] = term;
      await saveState({ currentIdx: state.currentIdx + 1 });

      if (state.currentIdx < state.terms.length) {
        const delay = jitterDelayMs();
        console.log("[PinTwist Automation] Next search in " + (delay/60000).toFixed(2) + " min");
        _pendingNextDeadline = Date.now() + delay;
        if (_pendingNextTimeout) clearTimeout(_pendingNextTimeout);
        _pendingNextTimeout = setTimeout(() => {
          _pendingNextTimeout = null;
          _pendingNextDeadline = 0;
          advanceAndNavigate();
        }, delay);
      } else {
        await saveState({ running: false });
        try { alert("PinTwist: Queue complete. " + state.terms.filter((x) => x.status === "done").length + " searches saved."); } catch {}
      }
    } catch (err) {
      console.error("[PinTwist Automation] term failed:", err);
      term.status = "failed";
      term.error = err && err.message ? err.message : String(err);
      state.terms[state.currentIdx] = term;
      await saveState({ currentIdx: state.currentIdx + 1 });
      setTimeout(() => advanceAndNavigate(), 5000);
    }
  }

  async function advanceAndNavigate() {
    await loadState();
    if (!state.running) return;
    while (state.currentIdx < state.terms.length) {
      const t = state.terms[state.currentIdx];
      if (t && t.status !== "done" && t.status !== "failed" && t.status !== "cancelled") break;
      state.currentIdx += 1;
    }
    if (state.currentIdx >= state.terms.length) {
      await saveState({ running: false });
      return;
    }
    await saveState({});
    const t = state.terms[state.currentIdx];
    location.href = searchUrlFor(t.term);
  }

  // Mount on whichever toolbar is currently visible — initial bar (before sort)
  // or resort bar (after sort completes). Both behave as positioning contexts.
  function getActiveBar() {
    return document.getElementById("pintwist-resort-bar")
        || document.getElementById("pintwist-initial-bar");
  }

  // Inject a Cancel button into the scan-progress popup (#pintwist-progress-panel).
  // The popup is what's visible during a scan ("Page X of 40"); the toolbar is
  // hidden. Setting State.aborted is all the existing scan engine needs — it
  // already shows "Cancelled" and removes the popup. If automation is running,
  // we also mark the current queue term as cancelled and pause the queue.
  function ensureProgressCancelButton() {
    const panel = document.getElementById("pintwist-progress-panel");
    if (!panel) return;
    if (panel.querySelector("#pintwist-progress-cancel")) return;
    const btn = document.createElement("button");
    btn.id = "pintwist-progress-cancel";
    btn.type = "button";
    btn.textContent = "Cancel scan";
    btn.className = "pintwist-progress-cancel";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { if (typeof State !== "undefined") State.aborted = true; } catch {}
      btn.disabled = true;
      btn.textContent = "Cancelling…";
      // If automation queue is running, mark current term cancelled + pause.
      try {
        await loadState();
        if (state && state.running) {
          if (state.terms[state.currentIdx] && state.terms[state.currentIdx].status === "running") {
            state.terms[state.currentIdx].status = "cancelled";
            state.terms[state.currentIdx].error = "user cancelled";
          }
          await saveState({ running: false });
        }
      } catch (err) { console.warn("[PinTwist Automation] cancel save failed:", err); }
    });
    panel.appendChild(btn);
  }

  function ensurePanel() {
    const bar = getActiveBar();
    if (!bar) return;
    // Toggle button — appended as last child of the bar; CSS pushes it right
    // via margin-left:auto so it always sits at the far right of the toolbar.
    let toggle = document.getElementById("pintwist-auto-toggle");
    if (toggle && !bar.contains(toggle)) {
      // bar changed (initial -> resort or vice versa) — relocate
      toggle.remove();
      toggle = null;
    }
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = "pintwist-auto-toggle";
      toggle.className = "pintwist-auto-toggle";
      bar.appendChild(toggle);
    }
    // Body dropdown — child of the bar, absolute-positioned right under it
    // so it visually appears as the toolbar "expanding downward".
    let body = document.getElementById("pintwist-auto-body");
    if (body && !bar.contains(body)) {
      body.remove();
      body = null;
      _bodyBuiltFor = null;
    }
    if (!body) {
      body = document.createElement("div");
      body.id = "pintwist-auto-body";
      body.className = "pintwist-auto-body";
      bar.appendChild(body);
      _bodyBuiltFor = null; // force a fresh scaffold on the new bar
    }
    renderPanel();
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return "0s";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? m + "m " + s + "s" : s + "s";
  }

  function escAuto(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Custom-spinner number field. Emits input + ▲▼ stacked buttons. Step,
  // min, max are stored as data-* so the click handler can clamp without
  // re-reading the input attributes (which strip step accuracy).
  function numField(id, min, max, step, value, extraClass) {
    const cls = "pintwist-auto-num" + (extraClass ? " " + extraClass : "");
    const stepStr = String(step);
    return '<span class="pintwist-auto-num-wrap">' +
      '<input type="number" id="' + id + '" min="' + min + '" max="' + max + '" step="' + stepStr + '" value="' + value + '" class="' + cls + '" data-step="' + stepStr + '" data-min="' + min + '" data-max="' + max + '">' +
      '<span class="pintwist-auto-num-spin">' +
      '<button type="button" class="pintwist-auto-num-up" data-target="' + id + '" tabindex="-1" aria-label="Increase">&#9650;</button>' +
      '<button type="button" class="pintwist-auto-num-down" data-target="' + id + '" tabindex="-1" aria-label="Decrease">&#9660;</button>' +
      '</span>' +
      '</span>';
  }

  // Render is split in two so the 1s tick doesn't blow away inputs while the
  // user is typing/pasting:
  //   renderToggle()        — cheap; runs every tick + on state change
  //   renderBodyScaffold()  — rebuilds form fields + queue ONLY when expanded
  //                           transitions or queue contents change
  //   renderQueueAndStats() — updates the queue rows + stats text in place
  //                           on every tick (does NOT touch inputs)
  let _bodyBuiltFor = null; // signature of last full body rebuild

  function renderToggle() {
    const toggle = document.getElementById("pintwist-auto-toggle");
    if (!toggle || !state) return;
    const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
    const inCooldown = cooldownLeft > 0;
    toggle.innerHTML =
      (state.panelExpanded ? "&#9660;" : "&#9654;") +
      ' &#129302; Automation' +
      (state.running ? ' <span class="pintwist-auto-dot"></span>' : '') +
      (inCooldown ? ' <span class="pintwist-auto-cooldown">' + fmtCountdown(cooldownLeft) + '</span>' : '');
    toggle.classList.toggle("pintwist-auto-toggle--open", !!state.panelExpanded);
    toggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await saveState({ panelExpanded: !state.panelExpanded });
    };
  }

  function bodySignature() {
    // Only the things that require a full rebuild. Form-control values are
    // intentionally NOT in the signature — the user owns them after open.
    return JSON.stringify({
      e: !!state.panelExpanded,
      n: state.terms.length,
      // include status of every term so the queue rebuilds when statuses change
      s: state.terms.map((t) => t.status + ":" + (t.pinCount || 0)).join(","),
    });
  }

  function renderBodyScaffold() {
    const body = document.getElementById("pintwist-auto-body");
    if (!body || !state) return;

    if (!state.panelExpanded) {
      body.style.display = "none";
      body.innerHTML = "";
      _bodyBuiltFor = null;
      return;
    }
    body.style.display = "block";

    const sig = bodySignature();
    if (sig === _bodyBuiltFor) return; // no rebuild needed
    _bodyBuiltFor = sig;

    // Preserve any in-flight user input across rebuilds (rare path).
    const prev = (() => {
      const ta = document.getElementById("pintwist-auto-terms");
      const pages = document.getElementById("pintwist-auto-pages");
      const interval = document.getElementById("pintwist-auto-interval");
      const pct = document.getElementById("pintwist-auto-randomize-pct");
      return {
        terms: ta && ta.value,
        pages: pages && pages.value,
        interval: interval && interval.value,
        pct: pct && pct.value,
      };
    })();

    const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
    const inCooldown = cooldownLeft > 0;

    const initialTerms = (typeof prev.terms === "string") ? prev.terms : state.terms.map((t) => t.term).join(", ");

    body.innerHTML =
      // Search-term entry: textarea + Add button. Adding APPENDS to queue
      // (deduped) instead of replacing — terms accumulate as pills below.
      '<div class="pintwist-auto-row-fields">' +
      '<label class="pintwist-auto-label">Add search terms (comma or newline separated):</label>' +
      '<div class="pintwist-auto-add-row">' +
      '<textarea id="pintwist-auto-terms" class="pintwist-auto-textarea" rows="2" placeholder="boho wall art, vintage florals, cottagecore prints">' + escAuto(typeof prev.terms === "string" ? prev.terms : "") + '</textarea>' +
      '<button id="pintwist-auto-add" type="button" class="pintwist-auto-btn pintwist-auto-btn--primary">+ Add to queue</button>' +
      '</div>' +
      '</div>' +
      // Pill bar — each term renders as a pill in #pintwist-auto-queue, with
      // X to remove + ▶ to run that one immediately. Re-rendered each tick.
      '<div class="pintwist-auto-pills" id="pintwist-auto-queue"></div>' +
      // Settings row — number inputs use a custom spinner (▲▼) wrapper for
      // consistent styling across browsers; the helper emits the input + the
      // stacked button column. Click handlers are delegated below.
      '<div class="pintwist-auto-row-fields">' +
      '<label>Pages/search ' + numField("pintwist-auto-pages", 1, 100, 1, (prev.pages || state.pagesPerTerm)) + '</label>' +
      '<label>Interval (min) ' + numField("pintwist-auto-interval", 0.25, 180, 0.25, (prev.interval || state.intervalMin)) + '</label>' +
      '<label class="pintwist-auto-checkbox"><input type="checkbox" id="pintwist-auto-randomize" ' + (state.randomize ? "checked" : "") + '> Randomize &plusmn;' + numField("pintwist-auto-randomize-pct", 0, 95, 1, (prev.pct || state.randomizePct), "pintwist-auto-num--xs") + ' %</label>' +
      '</div>' +
      // Master ON/OFF toggle + ▶/✗ shortcuts + secondary actions + countdown.
      // ▶ skips the countdown and runs the current term right now.
      // ✗ turns the toggle off (mirrors the pill buttons' semantics).
      '<div class="pintwist-auto-master-row">' +
      '<label class="pintwist-auto-switch">' +
      '<input type="checkbox" id="pintwist-auto-running"' + (state.running ? " checked" : "") + (inCooldown ? " disabled" : "") + '>' +
      '<span class="pintwist-auto-switch-track"><span class="pintwist-auto-switch-thumb"></span></span>' +
      '<span class="pintwist-auto-switch-label">Run automation</span>' +
      '</label>' +
      '<button id="pintwist-auto-runnow" class="pintwist-auto-iconbtn pintwist-auto-iconbtn--play" type="button" title="Run next term now (skip countdown)" aria-label="Run now">&#9654;</button>' +
      '<button id="pintwist-auto-off" class="pintwist-auto-iconbtn pintwist-auto-iconbtn--x" type="button" title="Turn automation off" aria-label="Turn off">&#10005;</button>' +
      '<span class="pintwist-auto-countdown" id="pintwist-auto-countdown"></span>' +
      '<span class="pintwist-auto-stats" id="pintwist-auto-stats"></span>' +
      '<button id="pintwist-auto-cancel" class="pintwist-auto-btn pintwist-auto-btn--danger"' + (state.running ? "" : " disabled") + '>Cancel scan</button>' +
      '<button id="pintwist-auto-clear" class="pintwist-auto-btn">Clear queue</button>' +
      '<button id="pintwist-auto-resume-cd" class="pintwist-auto-btn"' + (inCooldown ? "" : " disabled") + '>Skip cooldown</button>' +
      '</div>';

    wireBody(body);
    renderQueueAndStats();
  }

  function renderQueueAndStats() {
    if (!state || !state.panelExpanded) return;
    const queueEl = document.getElementById("pintwist-auto-queue");
    const statsEl = document.getElementById("pintwist-auto-stats");
    const cdEl = document.getElementById("pintwist-auto-countdown");
    if (!queueEl) return;

    // Pills: each term = a pill with status icon + label + ▶ + ✗.
    const pills = state.terms.map((t, i) => {
      const isCurrent = i === state.currentIdx && state.running;
      const icon = t.status === "done" ? "&#10003;"
                 : t.status === "failed" ? "&#10007;"
                 : t.status === "cancelled" ? "&#9209;"
                 : isCurrent ? "&#9654;"
                 : "&#8987;";
      const cls = "pintwist-auto-pill pintwist-auto-pill--" + t.status + (isCurrent ? " pintwist-auto-pill--current" : "");
      const detail = t.status === "done" ? (t.pinCount || 0) + " pins"
                   : t.status === "failed" ? "failed"
                   : t.status === "cancelled" ? "cancelled"
                   : isCurrent ? "scanning…"
                   : "";
      return '' +
        '<span class="' + cls + '" data-idx="' + i + '" data-term="' + escAuto(t.term) + '">' +
        '<span class="pintwist-auto-pill-icon">' + icon + '</span>' +
        '<span class="pintwist-auto-pill-text">' + escAuto(t.term) + (detail ? ' <em>(' + escAuto(detail) + ')</em>' : '') + '</span>' +
        '<button type="button" class="pintwist-auto-pill-play" data-idx="' + i + '" title="Run this term now">&#9654;</button>' +
        '<button type="button" class="pintwist-auto-pill-x" data-idx="' + i + '" title="Remove">&#10005;</button>' +
        '</span>';
    }).join("");
    queueEl.innerHTML = pills || '<div class="pintwist-auto-empty">No queue. Add some search terms above.</div>';

    if (statsEl) {
      const doneCount = state.terms.filter((x) => x.status === "done").length;
      const failedCount = state.terms.filter((x) => x.status === "failed").length;
      statsEl.innerHTML = state.terms.length === 0 ? "" : (doneCount + '/' + state.terms.length + ' done' + (failedCount ? ' &middot; ' + failedCount + ' failed' : ''));
    }

    // Live countdown — shows time until next scan, or scan-in-progress, or
    // cooldown remaining, or idle. Updates every 1s via the existing tick.
    if (cdEl) {
      const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      const inCooldown = cooldownLeft > 0;
      const isScanning = !!document.getElementById("pintwist-progress-panel");
      let txt = "";
      if (inCooldown) txt = '<span class="pintwist-auto-cd--cooldown">Cooldown: <strong>' + fmtCountdown(cooldownLeft) + '</strong></span>';
      else if (isScanning) txt = '<span class="pintwist-auto-cd--scanning">Scanning now…</span>';
      else if (_pendingNextDeadline > Date.now()) txt = 'Next scan in <strong>' + fmtCountdown(_pendingNextDeadline - Date.now()) + '</strong>';
      else if (state.running) txt = '<span class="pintwist-auto-cd--idle">Starting…</span>';
      else txt = '<span class="pintwist-auto-cd--off">Off</span>';
      cdEl.innerHTML = txt;
    }
  }

  function renderPanel() {
    renderToggle();
    renderBodyScaffold();
  }

  // Read the current settings inputs (pages / interval / randomize) and
  // persist them. Called from the toggle + the "Add" button + ▶ pill click.
  async function persistSettingsFromInputs(wrap) {
    const $ = (id) => wrap.querySelector("#" + id);
    const pagesPerTerm = Math.max(1, Math.min(100, parseInt($("pintwist-auto-pages").value, 10) || 40));
    const intervalMin = Math.max(0.25, Math.min(180, parseFloat($("pintwist-auto-interval").value) || 1));
    const randomizePct = Math.max(0, Math.min(95, parseInt($("pintwist-auto-randomize-pct").value, 10) || 40));
    await saveState({ pagesPerTerm, intervalMin, randomizePct, randomize: !!$("pintwist-auto-randomize").checked });
  }

  function wireBody(wrap) {
    const $ = (id) => wrap.querySelector("#" + id);
    const addBtn = $("pintwist-auto-add");
    const runningSwitch = $("pintwist-auto-running");
    const cancelBtn = $("pintwist-auto-cancel");
    const clearBtn = $("pintwist-auto-clear");
    const skipCd = $("pintwist-auto-resume-cd");
    const randomize = $("pintwist-auto-randomize");
    const queueEl = $("pintwist-auto-queue");

    // Add to queue: APPEND new terms (deduped against existing), don't replace.
    const doAdd = async () => {
      const ta = $("pintwist-auto-terms");
      const terms = parseTerms(ta.value);
      if (terms.length === 0) { alert("Paste at least one search term."); return; }
      const existing = new Set(state.terms.map((t) => t.term.trim().toLowerCase()));
      const toAdd = terms.filter((t) => !existing.has(t.trim().toLowerCase()));
      if (toAdd.length === 0) { ta.value = ""; alert("All those terms are already in the queue."); return; }
      const newItems = toAdd.map((t) => ({ term: t, status: "pending" }));
      ta.value = "";
      await persistSettingsFromInputs(wrap);
      await saveState({ terms: state.terms.concat(newItems) });
    };
    if (addBtn) addBtn.addEventListener("click", doAdd);
    // Enter submits (Shift+Enter inserts newline, the standard convention).
    const ta = $("pintwist-auto-terms");
    if (ta) ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doAdd();
      }
    });

    // Master ON/OFF toggle.
    //   ON  → save running=true, persist settings, schedule first scan after
    //         the configured interval (with jitter). The countdown is visible
    //         immediately so the user can see what's coming + has a window to
    //         hit ▶ (run now) or ✗ (off) before anything fires.
    //   OFF → save running=false, cancel any pending timeout. Does NOT abort
    //         an in-progress scan; use Cancel scan for that.
    if (runningSwitch) runningSwitch.addEventListener("change", async (e) => {
      const on = !!e.target.checked;
      if (on) {
        if (state.terms.filter((t) => t.status !== "done" && t.status !== "failed" && t.status !== "cancelled").length === 0) {
          if (!confirm("Queue has no pending terms. Reset cancelled/failed terms and start over?")) {
            e.target.checked = false;
            return;
          }
          state.terms = state.terms.map((t) => (t.status === "cancelled" || t.status === "failed") ? { term: t.term, status: "pending" } : t);
          state.currentIdx = state.terms.findIndex((x) => x.status !== "done");
          if (state.currentIdx === -1) state.currentIdx = 0;
        }
        try { if (typeof State !== "undefined") State.aborted = false; } catch {}
        await persistSettingsFromInputs(wrap);
        await saveState({ running: true, cooldownUntil: 0 });
        // Schedule first scan with a countdown (instead of firing immediately)
        // so the user sees what's about to happen + can ▶/✗ before it runs.
        const delay = jitterDelayMs();
        if (_pendingNextTimeout) clearTimeout(_pendingNextTimeout);
        _pendingNextDeadline = Date.now() + delay;
        _pendingNextTimeout = setTimeout(() => {
          _pendingNextTimeout = null;
          _pendingNextDeadline = 0;
          runOnceForCurrentPage();
        }, delay);
        renderQueueAndStats();
      } else {
        if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
        await saveState({ running: false });
      }
    });

    // ▶ Run now: cancel any pending countdown, kick off immediately.
    const runNowBtn = $("pintwist-auto-runnow");
    if (runNowBtn) runNowBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
      try { if (typeof State !== "undefined") State.aborted = false; } catch {}
      // Make sure we're running and persist settings before kicking off.
      if (state.terms.filter((t) => t.status !== "done" && t.status !== "failed" && t.status !== "cancelled").length === 0) {
        // Reset cancelled/failed so a Run now after everything's done still works.
        state.terms = state.terms.map((t) => (t.status === "cancelled" || t.status === "failed") ? { term: t.term, status: "pending" } : t);
        state.currentIdx = state.terms.findIndex((x) => x.status !== "done");
        if (state.currentIdx === -1) state.currentIdx = 0;
      }
      await persistSettingsFromInputs(wrap);
      await saveState({ running: true, cooldownUntil: 0 });
      runOnceForCurrentPage();
    });

    // ✗ Turn off: same effect as flipping the toggle to off.
    const offBtn = $("pintwist-auto-off");
    if (offBtn) offBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
      await saveState({ running: false });
      // Reflect on the toggle UI (state-change re-render handles the rest).
      if (runningSwitch) runningSwitch.checked = false;
    });

    // Pill clicks (delegated): ▶ = run now, ✗ = remove
    if (queueEl) queueEl.addEventListener("click", async (e) => {
      const playBtn = e.target.closest(".pintwist-auto-pill-play");
      const xBtn = e.target.closest(".pintwist-auto-pill-x");
      if (playBtn) {
        e.preventDefault(); e.stopPropagation();
        const idx = parseInt(playBtn.dataset.idx, 10);
        if (isNaN(idx) || !state.terms[idx]) return;
        // Reset this term's status if it was done/failed/cancelled, then jump
        // currentIdx to it and turn on running.
        if (state.terms[idx].status !== "pending") {
          state.terms[idx] = { term: state.terms[idx].term, status: "pending" };
        }
        if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
        try { if (typeof State !== "undefined") State.aborted = false; } catch {}
        await persistSettingsFromInputs(wrap);
        await saveState({ currentIdx: idx, running: true, cooldownUntil: 0 });
        runOnceForCurrentPage();
        return;
      }
      if (xBtn) {
        e.preventDefault(); e.stopPropagation();
        const idx = parseInt(xBtn.dataset.idx, 10);
        if (isNaN(idx)) return;
        const newTerms = state.terms.slice(0, idx).concat(state.terms.slice(idx + 1));
        let newIdx = state.currentIdx;
        if (idx < state.currentIdx) newIdx -= 1;
        else if (idx === state.currentIdx) newIdx = Math.min(newIdx, newTerms.length - 1);
        await saveState({ terms: newTerms, currentIdx: Math.max(0, newIdx) });
        return;
      }
    });

    // Cancel scan: immediate abort + pause queue. (See state-machine notes.)
    if (cancelBtn) cancelBtn.addEventListener("click", async () => {
      try { if (typeof State !== "undefined") State.aborted = true; } catch {}
      if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
      if (state.terms[state.currentIdx] && state.terms[state.currentIdx].status === "running") {
        state.terms[state.currentIdx].status = "cancelled";
        state.terms[state.currentIdx].error = "user cancelled";
      }
      await saveState({ running: false });
    });

    if (clearBtn) clearBtn.addEventListener("click", async () => {
      if ((state.running || state.terms.length > 0) && !confirm("Clear the entire queue?")) return;
      try { if (typeof State !== "undefined") State.aborted = true; } catch {}
      if (_pendingNextTimeout) { clearTimeout(_pendingNextTimeout); _pendingNextTimeout = null; _pendingNextDeadline = 0; }
      await saveState({ terms: [], currentIdx: 0, running: false });
    });

    if (skipCd) skipCd.addEventListener("click", async () => {
      if (!confirm("Skip the 1h cooldown and resume now? Pinterest may still rate-limit you.")) return;
      await saveState({ cooldownUntil: 0 });
    });

    if (randomize) randomize.addEventListener("change", async (e) => { await saveState({ randomize: e.target.checked }); });

    // Custom number-spinner clicks (delegated). Honors min/max/step from the
    // input's data-* attributes, fires "input" + "change" so any listeners
    // wired to the input (like settings-persist) trigger normally.
    wrap.addEventListener("click", (e) => {
      const upBtn = e.target.closest(".pintwist-auto-num-up");
      const downBtn = e.target.closest(".pintwist-auto-num-down");
      const btn = upBtn || downBtn;
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const input = wrap.querySelector("#" + btn.dataset.target);
      if (!input) return;
      const step = parseFloat(input.dataset.step) || 1;
      const min = parseFloat(input.dataset.min);
      const max = parseFloat(input.dataset.max);
      const cur = parseFloat(input.value) || 0;
      let next = upBtn ? cur + step : cur - step;
      if (!isNaN(min) && next < min) next = min;
      if (!isNaN(max) && next > max) next = max;
      // Round-trip through step grid to avoid float drift (e.g. 0.25 + 0.25 etc.)
      const decimals = (String(step).split(".")[1] || "").length;
      input.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // 1s tick: only refresh the toggle (cooldown countdown) and queue/stats.
  // Never re-render the form fields here — that destroys focus and pasted text.
  setInterval(() => {
    if (!state) return;
    renderToggle();
    if (state.panelExpanded) renderQueueAndStats();
  }, 1000);

  async function bootstrap() {
    await loadState();
    const tryMount = () => {
      const bar = getActiveBar();
      if (bar && !bar.querySelector("#pintwist-auto-toggle")) {
        ensurePanel();
        renderPanel();
        runOnceForCurrentPage();
      }
      // Also inject a Cancel button into the scan-progress popup whenever it
      // appears. This is visible during the actual scan when the toolbar is
      // hidden. Works for both manual sorts and automation runs.
      ensureProgressCancelButton();
      return !!bar;
    };
    tryMount();
    // Permanent observer: re-attach across SPA navigations + sort_all rebuilds.
    const obs = new MutationObserver(() => { tryMount(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(bootstrap, 2500);
  } else {
    window.addEventListener("load", () => setTimeout(bootstrap, 2500));
  }
})();
