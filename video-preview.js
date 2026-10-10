function prepareVideo(video, mode = 'metadata') {
    const previous = video.getAttribute('preload');
    if (previous === 'auto' || previous === mode) return;
    video.preload = mode;
    // Explicit preparation should not be delayed by native lazy-loading rules.
    video.removeAttribute('loading');
    // Upgrading to auto must retain the existing buffer and playback position.
    if (previous === 'none') video.load();
}

// Warm up nearby videos, without letting the whole gallery compete for bandwidth.
const videoObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            prepareVideo(entry.target);
            videoObserver.unobserve(entry.target);
        });
    }, { rootMargin: '1000px 0px' })
    : null;

// Buffer playable data before a video reaches the viewport, rather than waiting
// for the click. Keep this smaller than the metadata region to limit contention.
const bufferObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            prepareVideo(entry.target, 'auto');
            bufferObserver.unobserve(entry.target);
        });
    }, { rootMargin: '300px 0px' })
    : null;

document.querySelectorAll('video[poster]').forEach((video) => {
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

    video.addEventListener('pointerenter', () => prepareVideo(video, 'auto'), { once: true });
    video.addEventListener('pointerdown', () => prepareVideo(video, 'auto'), { once: true });
    video.addEventListener('keydown', () => prepareVideo(video, 'auto'), { once: true });
    if (videoObserver) videoObserver.observe(video);
    else prepareVideo(video);
    if (bufferObserver) bufferObserver.observe(video);
});
