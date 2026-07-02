const IosOverlayManager = {
    show: function(tipoOverlay) {
        const idTarget = `ios-overlay-${tipoOverlay}`;
        let overlayElement = document.getElementById(idTarget);
        
        if (!overlayElement) {
            overlayElement = document.createElement('div');
            overlayElement.id = idTarget;
            overlayElement.className = 'ios-transition-overlay';
            
            let innerHTMLContent = '<div class="ios-overlay-blur-bg"></div><div class="ios-overlay-content">';
            
            if (tipoOverlay === 'produtos') {
                innerHTMLContent += `
                    <div class="ios-icon-container animation-premium-fade">
                        <svg class="ios-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19 21H5C3.89543 21 3 20.1046 3 19V8C3 6.89543 3.89543 6 5 6H19C20.1046 6 21 6.89543 21 8V19C21 20.1046 20.1046 21 19 21Z" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M16 10V6C16 4.93913 15.5786 3.92172 14.8284 3.17157C14.0783 2.42143 13.0609 2 12 2C10.9391 2 9.92172 2.42143 9.17157 3.17157C8.42143 3.92172 8 4.93913 8 6V10" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>`;
            } else if (tipoOverlay === 'gourmet') {
                innerHTMLContent += `
                    <div class="ios-icon-container animation-gourmet-minimal">
                        <svg class="ios-svg-icon burger-top" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 11C3 7.5 6 5 12 5C18 5 21 7.5 21 11H3Z" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <svg class="ios-svg-icon burger-bottom" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 15H21V16C21 17.5 19.5 19 12 19C4.5 19 3 17.5 3 16V15Z" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>`;
            } else if (tipoOverlay === 'anuncios') {
                innerHTMLContent += `
                    <div class="ios-icon-container animation-premium-fade">
                        <svg class="ios-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11 5H6C4.89543 5 4 5.89543 4 7V13C4 14.1046 4.89543 15 6 15H7V20C7 20.5523 7.44772 21 8 21H10C10.5523 21 11 20.5523 11 20V15H11.5L17 19V1L11 5Z" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M19 9C19.5 9 20 10 20 11C20 12 19.5 13 19 13" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>`;
            }

            innerHTMLContent += `
                    <div class="ios-dots-loader">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>`;
                
            overlayElement.innerHTML = innerHTMLContent;
            document.body.appendChild(overlayElement);
        }
        
        requestAnimationFrame(function() {
            overlayElement.classList.add('ios-active');
        });
    },

    hide: function(tipoOverlay) {
        const idTarget = `ios-overlay-${tipoOverlay}`;
        const overlayElement = document.getElementById(idTarget);
        
        if (overlayElement) {
            overlayElement.classList.remove('ios-active');
        }
    },

    hideAll: function() {
        document.querySelectorAll('.ios-transition-overlay').forEach(function(overlay) {
            overlay.classList.remove('ios-active');
        });
    }
};

window.IosOverlayManager = IosOverlayManager;