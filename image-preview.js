// Only enable the reveal gate when this script has actually loaded.
document.documentElement.classList.add('image-loading');
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.priority-image').forEach((image) => {
        const reveal = () => image.classList.add('is-decoded');
        if (image.decode) {
            image.decode().then(reveal, reveal);
        } else if (image.complete) {
            reveal();
        } else {
            image.addEventListener('load', reveal, { once: true });
            image.addEventListener('error', reveal, { once: true });
        }
    });
}, { once: true });
