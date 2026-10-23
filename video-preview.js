// Preload only a small number of nearby videos. Previously every video that
// entered the viewport kept preload=auto for the rest of the visit.
const nearbyVideos = new Set();
const warmingVideos = new Set();
const playingVideos = new Set();
const videoLoadState = new WeakMap();
const connection = navigator.connection;
const MAX_BACKGROUND_LOADS = 2;
const STARTUP_BUFFER_SECONDS = 3;
let warmupScheduled = false;

function hasStartupBuffer(video) {
    if (video.readyState < 3 || !video.buffered.length) return false;
    const target = Number.isFinite(video.duration)
        ? Math.min(STARTUP_BUFFER_SECONDS, video.duration)
        : STARTUP_BUFFER_SECONDS;
    return video.buffered.start(0) < 0.1 && video.buffered.end(0) >= target - 0.05;
}

function prepareVideo(video) {
    video.preload = 'auto';
    video.removeAttribute('loading');
    // Never reset a video that already has metadata, buffered frames or a seek
    // position. Changing preload alone upgrades its existing media request.
    if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load();
}

function stopWarmup(video, abort = false) {
    const state = videoLoadState.get(video);
    clearTimeout(state.timer);
    warmingVideos.delete(video);
    if (!video.paused) return;
    video.preload = 'none';
    if (abort && !state.interacted && video.currentTime === 0) {
        // preload is only a hint; load() actually cancels an unused transfer.
        // User-started videos are never reset, so seeking and replay keep working.
        video.load();
        state.tried = false;
    }
}

function distanceToViewport(video) {
    const rect = video.getBoundingClientRect();
    return Math.max(0, rect.top - window.innerHeight, -rect.bottom);
}

function scheduleWarmups() {
    if (warmupScheduled) return;
    warmupScheduled = true;
    requestAnimationFrame(() => {
        warmupScheduled = false;
        if (document.hidden || playingVideos.size || connection?.saveData ||
            /(^|-)2g$/.test(connection?.effectiveType || '')) return;
        const candidates = [...nearbyVideos].filter(video => {
            const state = videoLoadState.get(video);
            return !state.tried && !state.interacted && !warmingVideos.has(video) &&
                !hasStartupBuffer(video);
        }).sort((a, b) => distanceToViewport(a) - distanceToViewport(b));
        for (const video of candidates) {
            if (warmingVideos.size >= MAX_BACKGROUND_LOADS) break;
            const state = videoLoadState.get(video);
            state.tried = true;
            warmingVideos.add(video);
            state.timer = setTimeout(() => {
                stopWarmup(video, true);
                state.tried = true; // Retry on a new approach or explicit interaction.
                scheduleWarmups();
            }, 12000);
            prepareVideo(video);
        }
    });
}

const videoObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            const video = entry.target;
            if (entry.isIntersecting) {
                nearbyVideos.add(video);
                videoLoadState.get(video).tried = false;
            } else {
                nearbyVideos.delete(video);
                if (warmingVideos.has(video)) stopWarmup(video, true);
            }
        }
        scheduleWarmups();
    }, { rootMargin: '800px 0px' })
    : null;

function prioritizeVideo(video) {
    videoLoadState.get(video).interacted = true;
    // Free the network for the video the visitor actually chose.
    for (const other of [...warmingVideos]) {
        if (other !== video) stopWarmup(other, true);
    }
    if (warmingVideos.has(video)) stopWarmup(video);
    prepareVideo(video);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        for (const video of [...warmingVideos]) stopWarmup(video, true);
    } else scheduleWarmups();
});

document.querySelectorAll('video[poster]').forEach((video) => {
    videoLoadState.set(video, { tried: false, interacted: false, timer: null });
    const preview = document.createElement('div');
    preview.className = 'video-preview';
    video.before(preview);
    preview.append(video);

    const poster = document.createElement('img');
    poster.className = 'video-startup-poster';
    poster.src = video.poster;
    poster.loading = 'lazy';
    poster.alt = '';
    poster.setAttribute('aria-hidden', 'true');
    preview.append(poster);

    let framePresented = false;
    let frameCallback = null;
    let generation = 0;

    function revealVideo() {
        framePresented = true;
        frameCallback = null;
        preview.classList.remove('is-starting');
    }

    function waitForFirstFrame() {
        if (framePresented) return;
        preview.classList.add('is-starting');

        if (video.requestVideoFrameCallback && frameCallback === null) {
            const currentGeneration = generation;
            frameCallback = video.requestVideoFrameCallback(() => {
                if (currentGeneration === generation) revealVideo();
            });
        }
    }

    function revealWithoutFrameCallback() {
        if (video.requestVideoFrameCallback || video.readyState < 2 ||
            !preview.classList.contains('is-starting')) return;
        const currentGeneration = generation;
        // Let the browser paint the decoded frame before removing the cover.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (currentGeneration === generation && video.readyState >= 2) {
                revealVideo();
            }
        }));
    }

    video.addEventListener('play', waitForFirstFrame);
    video.addEventListener('seeking', waitForFirstFrame);
    video.addEventListener('playing', revealWithoutFrameCallback);
    video.addEventListener('seeked', revealWithoutFrameCallback);
    video.addEventListener('loadeddata', revealWithoutFrameCallback);
    video.addEventListener('emptied', () => {
        generation += 1;
        if (frameCallback !== null && video.cancelVideoFrameCallback) {
            video.cancelVideoFrameCallback(frameCallback);
        }
        frameCallback = null;
        framePresented = false;
        preview.classList.remove('is-starting');
    });

    const finishWarmup = () => {
        if (warmingVideos.has(video) && hasStartupBuffer(video)) {
            video.preload = 'none';
            // A browser may finish its current byte-range request despite this
            // hint. Keep the slot until it really stops fetching.
            if (video.networkState === HTMLMediaElement.NETWORK_IDLE) {
                stopWarmup(video);
                scheduleWarmups();
            }
        }
    };
    video.addEventListener('suspend', () => {
        if (warmingVideos.has(video)) {
            stopWarmup(video);
            scheduleWarmups();
        }
    });
    video.addEventListener('progress', finishWarmup);
    video.addEventListener('canplay', finishWarmup);
    video.addEventListener('error', () => {
        playingVideos.delete(video);
        if (warmingVideos.has(video)) {
            stopWarmup(video, true);
            videoLoadState.get(video).tried = true;
        }
        scheduleWarmups();
    });
    video.addEventListener('play', () => {
        playingVideos.add(video);
        prioritizeVideo(video);
    });
    const playbackStopped = () => {
        playingVideos.delete(video);
        video.preload = 'none';
        scheduleWarmups();
    };
    video.addEventListener('pause', playbackStopped);
    video.addEventListener('ended', playbackStopped);
    video.addEventListener('pointerenter', () => {
        if (videoLoadState.get(video).interacted || hasStartupBuffer(video)) return;
        nearbyVideos.add(video);
        videoLoadState.get(video).tried = false;
        scheduleWarmups();
    });
    video.addEventListener('pointerdown', () => prioritizeVideo(video));
    video.addEventListener('keydown', () => prioritizeVideo(video));
    if (videoObserver) videoObserver.observe(video);
});
