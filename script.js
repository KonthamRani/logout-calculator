// ===================================
// TIMESTAMP PARSER
// ===================================

class TimestampParser {
    /**
     * Parse timestamps from the input text
     * Expected format:
     * 11:01:55 am
     * 03 Feb 2026
     * KGIT database new
     * Info
     * 12:49:32 pm
     * ...
     */
    static parseTimestamps(text) {
        if (!text || !text.trim()) {
            return [];
        }

        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        const timestamps = [];

        // Regex to match time patterns like "11:01:55 am", "12:49:32 pm", or "13:45:01"
        const timeRegex = /(\d{1,2}):(\d{2}):(\d{2})(?:\s*(am|pm))?/i;

        // Regex to match date patterns like "03 Feb 2026"
        const dateRegex = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;

        let currentDate = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this line is a time
            const timeMatch = line.match(timeRegex);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1]);
                const minutes = parseInt(timeMatch[2]);
                const seconds = parseInt(timeMatch[3]);
                const meridiem = timeMatch[4] ? timeMatch[4].toLowerCase() : null;

                // Convert to 24-hour format if meridiem is present
                if (meridiem) {
                    if (meridiem === 'pm' && hours < 12) {
                        hours += 12;
                    } else if (meridiem === 'am' && hours === 12) {
                        hours = 0;
                    }
                }
                // If no meridiem, assume hours is already in 24h format (0-23)
                // If meridiem is present but hours > 12 (like 13:45 pm), 
                // we treat it as already 24h and don't add 12 again.

                // Look ahead for the date on the next line
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const dateMatch = nextLine.match(dateRegex);

                    if (dateMatch) {
                        const day = parseInt(dateMatch[1]);
                        const monthStr = dateMatch[2];
                        const year = parseInt(dateMatch[3]);

                        // Parse month
                        const monthMap = {
                            'jan': 0, 'january': 0,
                            'feb': 1, 'february': 1,
                            'mar': 2, 'march': 2,
                            'apr': 3, 'april': 3,
                            'may': 4,
                            'jun': 5, 'june': 5,
                            'jul': 6, 'july': 6,
                            'aug': 7, 'august': 7,
                            'sep': 8, 'september': 8,
                            'oct': 9, 'october': 9,
                            'nov': 10, 'november': 10,
                            'dec': 11, 'december': 11
                        };

                        const month = monthMap[monthStr.toLowerCase()];

                        if (month !== undefined) {
                            currentDate = new Date(year, month, day, hours, minutes, seconds);
                            timestamps.push(currentDate);
                        }
                    }
                } else if (currentDate) {
                    // If no date found, use the current date context
                    const newDate = new Date(currentDate);
                    newDate.setHours(hours, minutes, seconds);
                    timestamps.push(newDate);
                }
            }
        }

        return timestamps.sort((a, b) => a - b);
    }

    /**
     * Calculate breaks and active time using alternating IN/OUT pattern
     * Pattern: Login (IN), OUT, IN, OUT, IN, OUT, IN, ...
     * - First timestamp: Login (IN)
     * - Odd indices (1, 3, 5...): OUT (break start)
     * - Even indices (2, 4, 6...): IN (break end)
     */
    static calculateBreaksAlternating(timestamps) {
        if (timestamps.length < 2) {
            return {
                breaks: [],
                totalBreakMinutes: 0,
                activeMinutes: 0,
                workPeriods: []
            };
        }

        const breaks = [];
        const workPeriods = [];
        let totalBreakMinutes = 0;
        let totalActiveMinutes = 0;

        // First work period: from login (index 0) to first OUT (index 1)
        if (timestamps.length >= 2) {
            const loginTime = timestamps[0];
            const firstOut = timestamps[1];
            const workMinutes = (firstOut - loginTime) / (1000 * 60);

            workPeriods.push({
                start: loginTime,
                end: firstOut,
                minutes: workMinutes
            });
            totalActiveMinutes += workMinutes;
        }

        // Process remaining timestamps in pairs (IN, OUT)
        for (let i = 1; i < timestamps.length - 1; i += 2) {
            const outTime = timestamps[i];     // Break start (OUT)
            const inTime = timestamps[i + 1];  // Break end (IN)

            // Calculate break duration
            const breakMinutes = Math.max(0, (inTime - outTime) / (1000 * 60));
            breaks.push({
                start: outTime,
                end: inTime,
                minutes: breakMinutes
            });
            totalBreakMinutes += breakMinutes;

            // If there's a next OUT, calculate work period from IN to OUT
            if (i + 2 < timestamps.length) {
                const nextOut = timestamps[i + 2];
                const workMinutes = Math.max(0, (nextOut - inTime) / (1000 * 60));

                workPeriods.push({
                    start: inTime,
                    end: nextOut,
                    minutes: workMinutes
                });
                totalActiveMinutes += workMinutes;
            } else {
                // Last timestamp is IN, so work continues until now
                const now = new Date();
                const workMinutes = Math.max(0, (now - inTime) / (1000 * 60));

                workPeriods.push({
                    start: inTime,
                    end: now,
                    minutes: workMinutes
                });
                totalActiveMinutes += workMinutes;
            }
        }

        // If last timestamp is OUT (odd number of timestamps), person is still on break
        if (timestamps.length % 2 === 0) {
            const lastOut = timestamps[timestamps.length - 1];
            const now = new Date();
            const ongoingBreakMinutes = (now - lastOut) / (1000 * 60);

            breaks.push({
                start: lastOut,
                end: now,
                minutes: ongoingBreakMinutes,
                ongoing: true
            });
            totalBreakMinutes += ongoingBreakMinutes;
        }

        return {
            breaks,
            totalBreakMinutes: Math.round(totalBreakMinutes),
            activeMinutes: Math.round(totalActiveMinutes),
            workPeriods
        };
    }

    /**
     * Calculate breaks between timestamps (legacy method for gaps)
     * Assumes gaps > 5 minutes are breaks
     */
    static calculateBreaks(timestamps, minBreakMinutes = 5) {
        if (timestamps.length < 2) {
            return { breaks: [], totalBreakMinutes: 0 };
        }

        const breaks = [];
        let totalBreakMinutes = 0;

        for (let i = 0; i < timestamps.length - 1; i++) {
            const current = timestamps[i];
            const next = timestamps[i + 1];
            const gapMinutes = (next - current) / (1000 * 60);

            if (gapMinutes >= minBreakMinutes) {
                breaks.push({
                    start: current,
                    end: next,
                    minutes: Math.round(gapMinutes)
                });
                totalBreakMinutes += gapMinutes;
            }
        }

        return { breaks, totalBreakMinutes: Math.round(totalBreakMinutes) };
    }

    /**
     * Calculate active work time (excluding breaks)
     */
    static calculateActiveTime(timestamps, breaks) {
        if (timestamps.length === 0) {
            return 0;
        }

        const now = new Date();
        const loginTime = timestamps[0];
        const lastTimestamp = timestamps[timestamps.length - 1];

        // Total time from login to now or last timestamp
        const endTime = now > lastTimestamp ? now : lastTimestamp;
        const totalMinutes = (endTime - loginTime) / (1000 * 60);

        // Subtract breaks
        const breakMinutes = breaks.reduce((sum, b) => sum + b.minutes, 0);
        const activeMinutes = totalMinutes - breakMinutes;

        return Math.max(0, activeMinutes);
    }
}

// ===================================
// CALCULATOR LOGIC
// ===================================

class LogoutCalculator {
    constructor() {
        this.form = document.getElementById('calculatorForm');
        this.resultCard = document.getElementById('resultCard');
        this.resultTime = document.getElementById('resultTime');
        this.activeWorkTime = document.getElementById('activeWorkTime');
        this.breakTime = document.getElementById('breakTime');
        this.timeRemaining = document.getElementById('timeRemaining');
        this.totalOfficeTime = document.getElementById('totalOfficeTime');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');

        this.timestampInput = document.getElementById('timestampInput');
        this.loginTimeInput = document.getElementById('loginTime');
        this.breakMinutesInput = document.getElementById('breakMinutes');
        this.workHoursInput = document.getElementById('workHours');

        // History elements
        this.saveHistoryBtn = document.getElementById('saveHistoryBtn');
        this.historyList = document.getElementById('historyList');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');

        this.history = JSON.parse(localStorage.getItem('workHistory')) || [];
        this.currentData = null; // Store current calculation data

        this.init();
    }

    init() {
        // Set default login time to current time
        this.setDefaultLoginTime();

        // Add event listeners
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Real-time calculation on input change
        this.timestampInput.addEventListener('input', () => this.handleRealTimeCalculation());
        this.loginTimeInput.addEventListener('input', () => this.handleRealTimeCalculation());
        this.breakMinutesInput.addEventListener('input', () => this.handleRealTimeCalculation());
        this.workHoursInput.addEventListener('input', () => this.handleRealTimeCalculation());

        // Advanced toggle
        const advancedToggle = document.getElementById('advancedToggle');
        const advancedSection = document.getElementById('advancedSection');

        advancedToggle.addEventListener('click', () => {
            advancedToggle.classList.toggle('active');
            if (advancedSection.style.display === 'none') {
                advancedSection.style.display = 'block';
            } else {
                advancedSection.style.display = 'none';
            }
        });

        // Theme selection
        const themeSelect = document.getElementById('themeSelect');
        const savedTheme = localStorage.getItem('theme') || 'office-light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        themeSelect.value = savedTheme;

        themeSelect.addEventListener('change', () => {
            const newTheme = themeSelect.value;
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });

        // Breakdown toggle
        const breakdownToggle = document.getElementById('breakdownToggle');
        const breakdownContent = document.getElementById('breakdownContent');

        if (breakdownToggle) {
            breakdownToggle.addEventListener('click', () => {
                breakdownToggle.classList.toggle('active');
                if (breakdownContent.style.display === 'none') {
                    breakdownContent.style.display = 'block';
                } else {
                    breakdownContent.style.display = 'none';
                }
            });
        }

        // History event listeners
        if (this.saveHistoryBtn) {
            this.saveHistoryBtn.addEventListener('click', () => this.saveToHistory());
        }
        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }

        // Display initial history
        this.updateHistoryUI();

        // Start live time remaining update
        this.startLiveUpdate();
    }

    setDefaultLoginTime() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        this.loginTimeInput.value = `${hours}:${minutes}`;
    }

    handleSubmit(e) {
        e.preventDefault();
        this.calculate();
    }

    handleRealTimeCalculation() {
        this.calculate();
    }

    calculate() {
        const timestampText = this.timestampInput.value.trim();

        // Determine which mode to use
        if (timestampText) {
            this.calculateFromTimestamps(timestampText);
        } else {
            this.calculateManual();
        }
    }

    calculateFromTimestamps(timestampText) {
        // Parse timestamps
        const timestamps = TimestampParser.parseTimestamps(timestampText);

        if (timestamps.length === 0) {
            this.showError('No valid timestamps found. Please check your input format.');
            return;
        }

        // Calculate breaks and active time using alternating IN/OUT pattern
        const { breaks, totalBreakMinutes, activeMinutes, workPeriods } =
            TimestampParser.calculateBreaksAlternating(timestamps);

        // Get required work hours
        const requiredWorkHours = parseFloat(this.workHoursInput.value) || 6;
        const requiredWorkMinutes = requiredWorkHours * 60;

        // Calculate remaining active work time needed
        const remainingActiveMinutes = Math.max(0, requiredWorkMinutes - activeMinutes);

        // Calculate logout time
        const now = new Date();
        const logoutDate = new Date(now.getTime() + remainingActiveMinutes * 60000);

        // Format logout time
        const logoutHours = String(logoutDate.getHours()).padStart(2, '0');
        const logoutMinutes = String(logoutDate.getMinutes()).padStart(2, '0');
        const logoutTimeFormatted = `${logoutHours}:${logoutMinutes}`;

        // Calculate progress
        const progressPercent = Math.min(100, Math.max(0, (activeMinutes / requiredWorkMinutes) * 100));

        // Calculate total office time
        const loginTime = timestamps[0];
        const totalOfficeMinutes = Math.max(0, (now - loginTime) / (1000 * 60));

        // Update UI
        this.updateResults({
            logoutTime: logoutTimeFormatted,
            activeMinutes: activeMinutes,
            breakMinutes: totalBreakMinutes,
            remainingMinutes: remainingActiveMinutes,
            progressPercent: progressPercent,
            totalOfficeMinutes: totalOfficeMinutes,
            isComplete: remainingActiveMinutes <= 0,
            breakCount: breaks.length
        });

        // Display breakdown
        this.displayBreakdown(workPeriods, breaks);

        // Store data for live updates
        this.currentCalculation = {
            mode: 'timestamp',
            timestamps,
            breaks,
            requiredWorkMinutes,
            loginTime,
            workPeriods
        };
    }

    calculateManual() {
        // Get form values
        const loginTime = this.loginTimeInput.value;
        const workHours = parseFloat(this.workHoursInput.value) || 6;
        const breakMinutes = parseInt(this.breakMinutesInput.value) || 0;

        if (!loginTime) {
            return; // Don't show error, just don't calculate
        }

        // Parse login time
        const [loginHours, loginMinutes] = loginTime.split(':').map(Number);
        const loginDate = new Date();
        loginDate.setHours(loginHours, loginMinutes, 0, 0);

        // Calculate total minutes to work
        const workMinutes = workHours * 60;
        const totalMinutes = workMinutes + breakMinutes;

        // Calculate logout time
        const logoutDate = new Date(loginDate.getTime() + totalMinutes * 60000);

        // Format logout time
        const logoutHours = String(logoutDate.getHours()).padStart(2, '0');
        const logoutMinutesFormatted = String(logoutDate.getMinutes()).padStart(2, '0');
        const logoutTimeFormatted = `${logoutHours}:${logoutMinutesFormatted}`;

        // Calculate time remaining
        const now = new Date();
        const remainingMs = logoutDate - now;
        const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

        // Calculate active time so far
        const elapsedMs = now - loginDate;
        const elapsedMinutes = Math.max(0, elapsedMs / 60000);
        const activeMinutes = Math.max(0, elapsedMinutes - breakMinutes);

        // Calculate progress
        const progressPercent = Math.min(100, Math.max(0, (activeMinutes / workMinutes) * 100));

        // Calculate total office time
        const totalOfficeMinutes = elapsedMinutes;

        // Update UI
        this.updateResults({
            logoutTime: logoutTimeFormatted,
            activeMinutes: activeMinutes,
            breakMinutes: breakMinutes,
            remainingMinutes: remainingMinutes,
            progressPercent: progressPercent,
            totalOfficeMinutes: totalOfficeMinutes,
            isComplete: remainingMs <= 0,
            breakCount: breakMinutes > 0 ? 1 : 0
        });

        // Store data for live updates
        this.currentCalculation = {
            mode: 'manual',
            loginDate,
            logoutDate,
            workMinutes,
            breakMinutes
        };
    }

    displayBreakdown(workPeriods, breaks) {
        const breakdownSection = document.getElementById('breakdownSection');
        const breakdownContent = document.getElementById('breakdownContent');

        if (!workPeriods || workPeriods.length === 0) {
            breakdownSection.style.display = 'none';
            return;
        }

        breakdownSection.style.display = 'block';
        breakdownContent.innerHTML = '';

        // Helper function to format time
        const formatTime = (date) => {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        };

        // Combine work periods and breaks, then sort by start time
        const allPeriods = [];

        workPeriods.forEach((period, index) => {
            allPeriods.push({
                type: 'work',
                start: period.start,
                end: period.end,
                minutes: period.minutes,
                index: index + 1
            });
        });

        breaks.forEach((breakPeriod, index) => {
            allPeriods.push({
                type: 'break',
                start: breakPeriod.start,
                end: breakPeriod.end,
                minutes: breakPeriod.minutes,
                index: index + 1,
                ongoing: breakPeriod.ongoing
            });
        });

        allPeriods.sort((a, b) => a.start - b.start);

        // Display periods
        allPeriods.forEach(period => {
            const item = document.createElement('div');
            item.className = `breakdown-item ${period.type}`;

            const label = document.createElement('span');
            label.className = 'breakdown-item-label';

            if (period.type === 'work') {
                label.textContent = `Work Period ${period.index}: ${formatTime(period.start)} - ${formatTime(period.end)}`;
            } else {
                const ongoingText = period.ongoing ? ' (ongoing)' : '';
                label.textContent = `Break ${period.index}: ${formatTime(period.start)} - ${formatTime(period.end)}${ongoingText}`;
            }

            const value = document.createElement('span');
            value.className = 'breakdown-item-value';
            value.textContent = `${Math.round(period.minutes)} min`;

            item.appendChild(label);
            item.appendChild(value);
            breakdownContent.appendChild(item);
        });
    }

    updateResults(data) {
        // Activate result card
        this.resultCard.classList.add('active');

        // Update logout time
        this.resultTime.textContent = data.logoutTime;

        // Update details
        const activeHours = (data.activeMinutes / 60).toFixed(1);
        this.activeWorkTime.textContent = `${activeHours} hours`;

        // Update break time
        const breakHours = Math.floor(data.breakMinutes / 60);
        const breakMins = Math.round(data.breakMinutes % 60);
        if (breakHours > 0) {
            this.breakTime.textContent = `${breakHours}h ${breakMins}m`;
        } else {
            this.breakTime.textContent = `${breakMins} mins`;
        }

        // Update time remaining
        if (data.isComplete) {
            this.timeRemaining.textContent = 'Work Complete! 🎉';
            this.timeRemaining.style.color = 'var(--color-accent-green)';
        } else {
            const remainingHours = Math.floor(data.remainingMinutes / 60);
            const remainingMins = Math.round(data.remainingMinutes % 60);
            const remainingText = remainingHours > 0
                ? `${remainingHours}h ${remainingMins}m`
                : `${remainingMins}m`;
            this.timeRemaining.textContent = remainingText;
            this.timeRemaining.style.color = 'var(--color-text-primary)';
        }

        // Update total office time
        const officeHours = (data.totalOfficeMinutes / 60).toFixed(1);
        this.totalOfficeTime.textContent = `${officeHours} hours`;

        // Update progress bar
        this.progressFill.style.width = `${data.progressPercent}%`;
        this.progressText.textContent = `Work progress: ${Math.round(data.progressPercent)}%`;

        // Store current data for saving to history
        this.currentData = data;
        if (this.saveHistoryBtn) {
            this.saveHistoryBtn.style.display = 'flex';
        }

        // Add celebration effect if complete
        if (data.isComplete && !this.celebrationShown) {
            this.celebrate();
            this.celebrationShown = true;
        } else if (!data.isComplete) {
            this.celebrationShown = false;
        }
    }

    saveToHistory() {
        if (!this.currentData) return;

        // Use the date from the calculations if available, otherwise default to today
        let displayDate = new Date().toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        if (this.currentCalculation && this.currentCalculation.loginTime) {
            displayDate = this.currentCalculation.loginTime.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        }

        const entry = {
            id: Date.now(),
            date: displayDate,
            activeHours: (this.currentData.activeMinutes / 60).toFixed(1),
            breakMinutes: this.currentData.breakMinutes,
            logoutTime: this.currentData.logoutTime
        };

        // Avoid duplicate entries for the same day (optional, but let's allow multiple for now or unique by date?)
        // Let's just push for now.
        this.history.unshift(entry);
        localStorage.setItem('workHistory', JSON.stringify(this.history));
        this.updateHistoryUI();

        // Visual feedback
        this.saveHistoryBtn.innerHTML = 'Saved! ✓';
        this.saveHistoryBtn.classList.add('enabled');
        setTimeout(() => {
            this.saveHistoryBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                </svg>
                Save to History
            `;
            this.saveHistoryBtn.classList.remove('enabled');
        }, 2000);
    }

    updateHistoryUI() {
        if (!this.historyList) return;

        if (this.history.length === 0) {
            this.historyList.innerHTML = '<tr><td colspan="5" class="no-history">No work logs found. Your history will appear here once saved.</td></tr>';
            return;
        }

        this.historyList.innerHTML = '';
        this.history.forEach(entry => {
            const row = document.createElement('tr');

            // Format break time as HH:mm
            const bHours = Math.floor(entry.breakMinutes / 60);
            const bMins = Math.round(entry.breakMinutes % 60);
            const formattedBreak = `${String(bHours).padStart(2, '0')}:${String(bMins).padStart(2, '0')}`;

            row.innerHTML = `
                <td>${entry.date}</td>
                <td>${entry.activeHours}h</td>
                <td>${formattedBreak}</td>
                <td><strong>${entry.logoutTime}</strong></td>
                <td>
                    <button class="btn-delete-item" onclick="window.calculator.deleteHistoryItem(${entry.id})">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </td>
            `;
            this.historyList.appendChild(row);
        });
    }

    deleteHistoryItem(id) {
        this.history = this.history.filter(item => item.id !== id);
        localStorage.setItem('workHistory', JSON.stringify(this.history));
        this.updateHistoryUI();
    }

    clearHistory() {
        if (confirm('Are you sure you want to clear all work history?')) {
            this.history = [];
            localStorage.setItem('workHistory', JSON.stringify(this.history));
            this.updateHistoryUI();
        }
    }

    startLiveUpdate() {
        // Update every 30 seconds
        setInterval(() => {
            if (this.currentCalculation) {
                this.calculate();
            }
        }, 30000);
    }

    celebrate() {
        // Add confetti effect
        this.createConfetti();

        // Play celebration animation
        this.resultCard.style.animation = 'none';
        setTimeout(() => {
            this.resultCard.style.animation = 'pulse 0.5s ease';
        }, 10);
    }

    createConfetti() {
        const colors = ['#667eea', '#764ba2', '#f093fb', '#43e97b', '#4facfe'];
        const confettiCount = 50;

        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'fixed';
            confetti.style.width = '10px';
            confetti.style.height = '10px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.top = '-10px';
            confetti.style.borderRadius = '50%';
            confetti.style.pointerEvents = 'none';
            confetti.style.zIndex = '9999';
            confetti.style.opacity = '0';
            confetti.style.animation = `confettiFall ${2 + Math.random() * 3}s linear forwards`;

            document.body.appendChild(confetti);

            setTimeout(() => {
                confetti.remove();
            }, 5000);
        }
    }

    showError(message) {
        alert(message);
    }
}

// ===================================
// CONFETTI ANIMATION
// ===================================
const style = document.createElement('style');
style.textContent = `
    @keyframes confettiFall {
        0% {
            opacity: 1;
            transform: translateY(0) rotate(0deg);
        }
        100% {
            opacity: 0;
            transform: translateY(100vh) rotate(720deg);
        }
    }
`;
document.head.appendChild(style);

// ===================================
// INITIALIZE APP
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    window.calculator = new LogoutCalculator();
});

// ===================================
// UTILITY FUNCTIONS
// ===================================

// Add smooth scroll behavior
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to calculate
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('calculateBtn').click();
    }
});
