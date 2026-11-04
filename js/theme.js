    // ---------- 主题 ----------
    const applyTheme = () => {
        const saved = localStorage.getItem('theme');
        const isDark = saved
            ? (saved === 'dark')
            : (new Date().getHours() < 7 || new Date().getHours() >= 18);
        setTheme(isDark ? 'dark' : 'light');
    };
    const setTheme = (theme) => {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        if (document.body.dataset.accentTheme) {
            setAccentTheme(document.body.dataset.accentTheme,
                settingsDraft ? settingsDraft.accentColor : config.accentColor);
        }
    };

    const colorLuminance = values => values.map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

    const adjustColorForBackground = (color, darkMode) => {
        const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
        if (darkMode) {
            while (colorLuminance(rgb) < 0.35) {
                rgb.forEach((value, index) => {
                    rgb[index] = Math.min(255, Math.round(value + (255 - value) * 0.12));
                });
            }
        } else {
            while (colorLuminance(rgb) > 0.18) {
                rgb.forEach((value, index) => { rgb[index] = Math.round(value * 0.9); });
            }
        }
        return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
    };

    const getHue = color => {
        const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (!delta) return 0;
        const sector = max === r ? ((g - b) / delta) % 6
            : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        return (sector * 60 + 360) % 360;
    };

    const setAccentTheme = (theme, color = config.accentColor) => {
        const safeTheme = ACCENT_THEMES.includes(theme) ? theme : 'blue';
        const safeColor = validColor(color) ? color.toLowerCase() : '#bee4ff';
        const isDark = document.body.classList.contains('dark-mode');
        const baseColor = safeTheme === 'custom' ? safeColor : ACCENT_COLORS[safeTheme];
        const iconColor = adjustColorForBackground(baseColor, isDark);
        document.body.dataset.accentTheme = safeTheme;
        document.body.style.setProperty('--custom-page-fill', safeColor);
        document.body.style.setProperty('--custom-primary-color', adjustColorForBackground(safeColor, false));
        document.body.style.setProperty('--custom-dark-primary-color', adjustColorForBackground(safeColor, true));
        document.body.style.setProperty('--custom-close-filter', `hue-rotate(${Math.round(getHue(iconColor) - 198)}deg)`);
        const iconFlood = document.getElementById('themeIconFlood');
        if (iconFlood) iconFlood.setAttribute('flood-color', iconColor);
        document.querySelectorAll('.accent-theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.accentTheme === safeTheme);
        });
        const customPicker = document.getElementById('accentCustomPicker');
        const customColor = document.getElementById('accentCustomColor');
        if (customPicker) customPicker.classList.toggle('active', safeTheme === 'custom');
        if (customColor) customColor.value = safeColor;
    };

    const setBackgroundImage = (imageData = '') => {
        const safeImage = validBackgroundImage(imageData) ? imageData : '';
        document.body.classList.toggle('has-custom-background', !!safeImage);
        document.body.style.setProperty(
            '--custom-background-image',
            safeImage ? `url("${safeImage}")` : 'none'
        );
        if (els.backgroundImageStatus) {
            els.backgroundImageStatus.textContent = safeImage ? '已选择自定义背景' : '未设置背景';
        }
        if (els.clearBackgroundBtn) els.clearBackgroundBtn.disabled = !safeImage;
    };

    const setInterfaceOpacity = (value = 1) => {
        const opacity = Math.max(0.2, Math.min(1, Number(value) || 1));
        document.body.style.setProperty('--interface-opacity-percent', `${Math.round(opacity * 100)}%`);
        if (els.interfaceOpacityRange) els.interfaceOpacityRange.value = String(Math.round(opacity * 100));
        if (els.interfaceOpacityValue) els.interfaceOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
    };

    const compressBackgroundImage = file => new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('invalid-image'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read-failed'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('decode-failed'));
            image.onload = () => {
                const maxSide = 1600;
                const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
                const width = Math.max(1, Math.round(image.width * scale));
                const height = Math.max(1, Math.round(image.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) { reject(new Error('canvas-failed')); return; }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, width, height);
                context.drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

