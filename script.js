// Enhanced Portfolio JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all features
    initScrollProgress();
    initBackToTop();
    initLoadingAnimations();
    initTypingEffect();
    initProjectFilters();
    initContactForm();
    initThemeToggle();
    
    console.log('Portfolio initialized successfully! 🚀');
});

// Scroll Progress Bar
function initScrollProgress() {
    const progressBar = document.createElement('div');
    progressBar.className = 'scroll-progress';
    document.body.appendChild(progressBar);
    
    window.addEventListener('scroll', function() {
        const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (window.scrollY / windowHeight) * 100;
        progressBar.style.width = scrolled + '%';
    });
}

// Back to Top Button
function initBackToTop() {
    const backToTopBtn = document.createElement('button');
    backToTopBtn.className = 'back-to-top';
    backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    backToTopBtn.setAttribute('aria-label', 'Back to top');
    document.body.appendChild(backToTopBtn);
    
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTopBtn.classList.add('show');
        } else {
            backToTopBtn.classList.remove('show');
        }
    });
    
    backToTopBtn.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// Loading Animations
function initLoadingAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('loaded');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Add loading class to elements and observe them
    const animateElements = document.querySelectorAll('.project-card, .skill-category, .contact-info');
    animateElements.forEach(el => {
        el.classList.add('loading');
        observer.observe(el);
    });
}

// Typing Effect for Hero Section
function initTypingEffect() {
    const texts = ["Quality Assurance Engineer", "Data Scientist", "Automation Expert", "Problem Solver"];
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    const typingSpeed = 100;
    const deletingSpeed = 50;
    const delayBetweenTexts = 2000;
    
    const heroLead = document.querySelector('.hero .lead');
    if (!heroLead) return;
    
    function typeText() {
        const currentText = texts[textIndex];
        
        if (isDeleting) {
            heroLead.textContent = currentText.substring(0, charIndex - 1);
            charIndex--;
        } else {
            heroLead.textContent = currentText.substring(0, charIndex + 1);
            charIndex++;
        }
        
        let speed = isDeleting ? deletingSpeed : typingSpeed;
        
        if (!isDeleting && charIndex === currentText.length) {
            speed = delayBetweenTexts;
            isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            textIndex = (textIndex + 1) % texts.length;
        }
        
        setTimeout(typeText, speed);
    }
    
    // Start typing effect
    setTimeout(typeText, 1000);
}

// Project Filters Enhancement
function initProjectFilters() {
    const tabButtons = document.querySelectorAll('#roleTabs .nav-link');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-bs-target');
            
            // Add loading effect
            tabPanes.forEach(pane => {
                pane.style.opacity = '0.5';
            });
            
            setTimeout(() => {
                tabPanes.forEach(pane => {
                    pane.style.opacity = '1';
                });
                
                // Animate project cards
                const activePane = document.querySelector(targetTab);
                if (activePane) {
                    const cards = activePane.querySelectorAll('.project-card');
                    cards.forEach((card, index) => {
                        card.style.transform = 'translateY(20px)';
                        card.style.opacity = '0';
                        
                        setTimeout(() => {
                            card.style.transform = 'translateY(0)';
                            card.style.opacity = '1';
                        }, index * 100);
                    });
                }
            }, 200);
        });
    });
}

// Contact Form Enhancement
function initContactForm() {
    // Create a contact form if it doesn't exist
    const contactSection = document.querySelector('#contact .contact-info');
    if (!contactSection) return;
    
    const formHTML = `
        <div class="contact-form mt-5">
            <h4 class="mb-4">Send Me a Message</h4>
            <form id="contactForm">
                <div class="form-group">
                    <label for="name" class="form-label">Name *</label>
                    <input type="text" class="form-control" id="name" required>
                </div>
                <div class="form-group">
                    <label for="email" class="form-label">Email *</label>
                    <input type="email" class="form-control" id="email" required>
                </div>
                <div class="form-group">
                    <label for="subject" class="form-label">Subject *</label>
                    <input type="text" class="form-control" id="subject" required>
                </div>
                <div class="form-group">
                    <label for="message" class="form-label">Message *</label>
                    <textarea class="form-control" id="message" rows="5" required></textarea>
                </div>
                <button type="submit" class="btn btn-primary-custom">
                    <i class="fas fa-paper-plane me-2"></i>Send Message
                </button>
            </form>
        </div>
    `;
    
    contactSection.insertAdjacentHTML('beforeend', formHTML);
    
    // Handle form submission
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const button = this.querySelector('button[type="submit"]');
            const originalText = button.innerHTML;
            
            // Show loading state
            button.classList.add('btn-loading');
            button.disabled = true;
            
            // Simulate form submission
            setTimeout(() => {
                button.classList.remove('btn-loading');
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-check me-2"></i>Message Sent!';
                button.style.background = '#10b981';
                
                // Reset form
                this.reset();
                
                // Reset button after delay
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.background = '';
                }, 3000);
                
                // Show success message
                showNotification('Message sent successfully!', 'success');
            }, 2000);
        });
    }
}

// Theme Toggle (Dark/Light Mode)
function initThemeToggle() {
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    themeToggle.style.cssText = `
        position: fixed;
        top: 50%;
        right: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        border: none;
        background: var(--primary-color);
        color: white;
        font-size: 1.2rem;
        cursor: pointer;
        z-index: 1000;
        transition: all 0.3s ease;
        transform: translateY(-50%);
    `;
    
    document.body.appendChild(themeToggle);
    
    // Check for saved theme preference
    const savedTheme = localStorage.getItem('portfolio-theme');
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    }
    
    themeToggle.addEventListener('click', function() {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('portfolio-theme', newTheme);
        updateThemeIcon(newTheme);
    });
    
    function updateThemeIcon(theme) {
        const icon = themeToggle.querySelector('i');
        icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// Notification System
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        border-radius: 10px;
        z-index: 9999;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after delay
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Performance Optimization: Lazy Loading Images
function initLazyLoading() {
    const images = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(img => {
        imageObserver.observe(img);
    });
}

// Keyboard Navigation Enhancement
document.addEventListener('keydown', function(e) {
    // Press 'Escape' to close any open modals or overlays
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.show');
        if (activeModal) {
            const modal = bootstrap.Modal.getInstance(activeModal);
            modal.hide();
        }
    }
    
    // Press 'Home' to go to top
    if (e.key === 'Home' && e.ctrlKey) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // Press 'End' to go to bottom
    if (e.key === 'End' && e.ctrlKey) {
        e.preventDefault();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
});

// Analytics and Tracking (if needed)
function trackProjectView(projectName) {
    // This would integrate with Google Analytics or other tracking services
    console.log(`Project viewed: ${projectName}`);
    
    // Example: gtag('event', 'project_view', { project_name: projectName });
}

// Add click tracking to project cards
document.addEventListener('click', function(e) {
    const projectCard = e.target.closest('.project-card');
    if (projectCard) {
        const projectTitle = projectCard.querySelector('.project-title');
        if (projectTitle) {
            trackProjectView(projectTitle.textContent);
        }
    }
});

// Error Handling
window.addEventListener('error', function(e) {
    console.error('Portfolio Error:', e.error);
    // You could send this to an error tracking service
});

// Service Worker Registration (for PWA features)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('SW registered: ', registration);
            })
            .catch(function(registrationError) {
                console.log('SW registration failed: ', registrationError);
            });
    });
}
