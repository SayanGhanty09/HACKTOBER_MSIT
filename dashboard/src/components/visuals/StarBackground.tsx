import React, { useEffect, useRef } from 'react';

const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

class Star {
    x: number;
    y: number;
    size: number;
    baseX: number;
    baseY: number;
    speed: number;
    opacity: number;
    hue: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
        this.canvas = canvas;
        this.ctx = ctx;
        const w = canvas.width;
        const h = canvas.height;
        this.baseX = Math.random() * w;
        this.baseY = Math.random() * h;
        this.x = this.baseX;
        this.y = this.baseY;
        this.size = Math.random() * 2.5 + 0.5; // Larger stars
        // Faster movement for more "heavy" parallax feel
        this.speed = this.size * 3.5;
        this.opacity = Math.random() * 0.7 + 0.3; // More opaque
        this.hue = Math.random() > 0.7 ? 200 : 0; // More blue stars
    }

    update() {
        // Increased sensitivity for cursor tracking
        const dx = (mouse.x - this.canvas.width / 2) / 15;
        const dy = (mouse.y - this.canvas.height / 2) / 15;

        const targetX = this.baseX + dx * this.speed;
        const targetY = this.baseY + dy * this.speed;

        this.x += (targetX - this.x) * 0.08; // Slightly more elastic movement
        this.y += (targetY - this.y) * 0.08;

        if (Math.random() > 0.98) {
            this.opacity = Math.random() * 0.5 + 0.4;
        }
    }

    draw() {
        this.ctx.fillStyle = this.hue > 0
            ? `hsla(${this.hue}, 100%, 85%, ${this.opacity})`
            : `rgba(255, 255, 255, ${this.opacity})`;

        this.ctx.beginPath();
        this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        this.ctx.fill();

        if (this.size > 1.5) {
            this.ctx.shadowBlur = 15; // More prominent glow
            this.ctx.shadowColor = this.hue > 0 ? '#00d2ff' : 'white';
        } else {
            this.ctx.shadowBlur = 0;
        }
    }
}

const StarBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let stars: Star[] = [];

        const init = () => {
            if (!canvas) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            stars = [];
            const density = 8000; // Increased density (fewer pixels per star)
            const count = Math.floor((canvas.width * canvas.height) / density);

            for (let i = 0; i < count; i++) {
                stars.push(new Star(canvas, ctx));
            }
        };

        const animate = () => {
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            stars.forEach(star => {
                star.update();
                star.draw();
            });

            animationFrameId = requestAnimationFrame(animate);
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        };

        const handleResize = () => {
            init();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('resize', handleResize);
        init();
        animate();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: -1, // Sits above Spline (-2) but behind Shell (0+)
                opacity: 1 // Full opacity
            }}
        />
    );
};

export default StarBackground;
