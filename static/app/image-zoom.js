/**
 * 图像点击放大功能模块
 */

export function initImageZoom() {
    // 创建放大图层
    const overlay = document.createElement('div');
    overlay.className = 'image-zoom-overlay';
    overlay.innerHTML = '<img src="" alt="Zoomed Image">';
    document.body.appendChild(overlay);

    const zoomedImg = overlay.querySelector('img');

    // 监听点击事件
    document.addEventListener('click', (e) => {
        const target = e.target;
        
        // 如果点击的是可放大的二维码
        if (target.classList.contains('clickable-qr')) {
            zoomedImg.src = target.src;
            overlay.style.display = 'flex';
            setTimeout(() => {
                overlay.classList.add('show');
            }, 10);
        }
        
        // 如果点击的是放大图层（或者其中的图片），则关闭
        if (overlay.classList.contains('show') && (target === overlay || target === zoomedImg)) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }
    });

    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }
    });
}
