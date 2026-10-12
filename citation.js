const copyButton = document.getElementById('copy-bibtex');
const bibtexEntry = document.getElementById('bibtex-entry');
const copyStatus = document.getElementById('copy-status');

copyButton.addEventListener('click', async () => {
    copyButton.disabled = true;
    copyStatus.textContent = '';
    try {
        await navigator.clipboard.writeText(bibtexEntry.textContent);
        copyStatus.textContent = 'BibTeX copied to clipboard.';
    } catch {
        // Keep the citation selectable when clipboard permission is unavailable.
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(bibtexEntry);
        selection.removeAllRanges();
        selection.addRange(range);
        copyStatus.textContent = 'Copy unavailable. The BibTeX is selected; press Ctrl+C or ⌘C to copy.';
    } finally {
        copyButton.disabled = false;
    }
});
