/**
 * Lightweight, non-blocking toast notifications — a drop-in replacement for the
 * blocking alert() calls the app used to use. Toasts stack in a fixed container,
 * auto-dismiss, and can be dismissed early by clicking.
 */

export function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        // Fallback so a missing container never swallows an important message.
        console.log(`[toast:${type}] ${message}`);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    container.appendChild(toast);

    // Next frame so the enter transition runs.
    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    const dismiss = () => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 250);
    };
    const timer = setTimeout(dismiss, duration);
    toast.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
    });
}
