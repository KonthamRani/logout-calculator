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
    static calculateBreaksAlternating(timestamps, referenceTime = new Date()) {
        if (timestamps.length === 0) {
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

        // Process all intervals between timestamps
        for (let i = 0; i < timestamps.length - 1; i++) {
            const start = timestamps[i];
            const end = timestamps[i + 1];
            const minutes = (end - start) / (1000 * 60);

            if (i % 2 === 0) {
                // Even index interval (0-1, 2-3...): Work
                workPeriods.push({
                    start: start,
                    end: end,
                    minutes: minutes
                });
                totalActiveMinutes += minutes;
            } else {
                // Odd index interval (1-2, 3-4...): Break
                breaks.push({
                    start: start,
                    end: end,
                    minutes: minutes
                });
                totalBreakMinutes += minutes;
            }
        }

        // Handle the ongoing period from the last timestamp to the reference time
        const lastTS = timestamps[timestamps.length - 1];

        // Only add ongoing period if reference time is after last timestamp
        if (referenceTime > lastTS) {
            const lastMinutes = (referenceTime - lastTS) / (1000 * 60);

            if (timestamps.length % 2 === 1) {
                // Odd number of timestamps: Last period is ongoing Work
                workPeriods.push({
                    start: lastTS,
                    end: referenceTime,
                    minutes: lastMinutes,
                    ongoing: true
                });
                totalActiveMinutes += lastMinutes;
            } else {
                // Even number of timestamps: Last period is ongoing Break
                breaks.push({
                    start: lastTS,
                    end: referenceTime,
                    minutes: lastMinutes,
                    ongoing: true
                });
                totalBreakMinutes += lastMinutes;
            }
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

        this.currentData = null; // Store current calculation data
        this.notificationsEnabled = false;
        this.alarmSound = document.getElementById('alarmSound');
        this.notifiedFiveMin = false;
        this.notifiedComplete = false;

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

        // Alarm Settings
        this.alarmMinutesBefore = 0;
        const alarmChips = document.querySelectorAll('.alarm-chip:not(.test-btn)');
        alarmChips.forEach(chip => {
            chip.addEventListener('click', () => {
                // Update active state
                alarmChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                
                // Update value
                this.alarmMinutesBefore = parseInt(chip.dataset.value);
                
                // Request permission if enabled
                if (this.alarmMinutesBefore > 0 && "Notification" in window) {
                    Notification.requestPermission();
                }

                // Reset notification flags
                this.notifiedLeadTime = false;
                this.notifiedComplete = false;
            });
        });

        // Sound Library
        this.soundSelect = document.getElementById('soundSelect');
        this.alarmSound = document.getElementById('alarmSound');
        this.alarmSource = document.getElementById('alarmSource');
        
        const soundMap = {
            'chime': 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
            'bell': 'https://assets.mixkit.co/active_storage/sfx/1017/1017-preview.mp3',
            'alert': 'https://assets.mixkit.co/active_storage/sfx/2190/2190-preview.mp3'
        };

        this.soundSelect.addEventListener('change', () => {
            const soundUrl = soundMap[this.soundSelect.value];
            this.alarmSource.src = soundUrl;
            this.alarmSound.load(); // Reload audio with new source
            
            // Play a short preview
            this.alarmSound.currentTime = 0;
            this.alarmSound.play().catch(e => console.log("Preview blocked:", e));
            setTimeout(() => {
                this.alarmSound.pause();
                this.alarmSound.currentTime = 0;
            }, 1000);
        });

        // History Management
        this.historyList = document.getElementById('historyList');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.history = JSON.parse(localStorage.getItem('logout_history') || '[]');
        
        this.clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all history?')) {
                this.history = [];
                this.saveHistory();
                this.renderHistory();
            }
        });

        this.renderHistory();

        // Test Alarm
        this.testAlarmBtn = document.getElementById('testAlarmBtn');
        if (this.testAlarmBtn) {
            this.testAlarmBtn.addEventListener('click', () => {
                this.playAlarm("Alarm Test", "This is how the logout alarm sounds!");
            });
        }

        // Start live time remaining update
        this.startLiveUpdate();
    }

    saveHistory() {
        localStorage.setItem('logout_history', JSON.stringify(this.history));
    }

    renderHistory() {
        if (!this.historyList) return;
        
        if (this.history.length === 0) {
            this.historyList.innerHTML = '<div class="history-empty">No history recorded yet. Complete a shift to see it here!</div>';
            return;
        }

        // Sort history by date (newest first)
        const sortedHistory = [...this.history].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        this.historyList.innerHTML = '';
        sortedHistory.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            const date = new Date(item.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            
            historyItem.innerHTML = `
                <div class="history-date">${date}</div>
                <div class="history-work">Work: ${item.activeTime}h</div>
                <div class="history-breaks">Breaks: ${item.breakTime}m</div>
                <div class="history-total">Total: ${item.totalTime}h</div>
            `;
            
            this.historyList.appendChild(historyItem);
        });
    }

    addToHistory(data) {
        // Create a unique key for the day (e.g. "2026-05-26")
        const dateKey = new Date().toISOString().split('T')[0];
        
        // Find if we already have an entry for today
        const existingIndex = this.history.findIndex(item => item.id === dateKey);
        
        const historyEntry = {
            id: dateKey,
            date: new Date().toISOString(),
            activeTime: (data.activeMinutes / 60).toFixed(2),
            breakTime: data.breakMinutes,
            totalTime: (data.totalOfficeMinutes / 60).toFixed(2)
        };

        if (existingIndex > -1) {
            // Update existing entry
            this.history[existingIndex] = historyEntry;
        } else {
            // Add new entry
            this.history.push(historyEntry);
        }

        this.saveHistory();
        this.renderHistory();
    }

    checkAlarm(remainingMinutes, isComplete) {
        if (this.alarmMinutesBefore === 0 && !isComplete) return;

        // Trigger at lead time (5m or 10m)
        if (this.alarmMinutesBefore > 0 && remainingMinutes <= this.alarmMinutesBefore && remainingMinutes > 0 && !this.notifiedLeadTime) {
            this.playAlarm(`Log out soon!`, `${remainingMinutes} minutes left until your daily goal.`);
            this.notifiedLeadTime = true;
        }

        // Trigger on completion (always if any alarm is set, or if it's the first time reaching zero)
        if (isComplete && !this.notifiedComplete) {
            // Only play completion alarm if some alarm was set OR it's a fresh completion
            this.playAlarm("Work Complete! 🎉", "You've reached your daily goal. Time to logout!");
            this.notifiedComplete = true;
        }

        // Reset flags if time changes (e.g. user adds more time or timestamps)
        if (remainingMinutes > this.alarmMinutesBefore) {
            this.notifiedLeadTime = false;
        }
        if (!isComplete) {
            this.notifiedComplete = false;
        }
    }

    playAlarm(title, body) {
        // Play sound
        this.alarmSound.currentTime = 0;
        this.alarmSound.play().catch(e => console.log("Failed to play alarm:", e));

        // Show browser notification
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, {
                body: body,
                icon: 'logo.png'
            });
        } else {
            // Fallback for no notifications
            alert(`${title}\n${body}`);
        }
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

        // Determine if this is "Live" (today) or "History" (past/yesterday)
        const now = new Date();
        const lastTimestamp = timestamps[timestamps.length - 1];

        // If the last timestamp is not from today, we treat it as a finished history record
        const isToday = lastTimestamp.getDate() === now.getDate() &&
            lastTimestamp.getMonth() === now.getMonth() &&
            lastTimestamp.getFullYear() === now.getFullYear();

        // Use current time as reference for live today calculations, 
        // otherwise use the last timestamp for history records.
        const referenceTime = isToday ? now : lastTimestamp;

        // Calculate breaks and active time using alternating IN/OUT pattern
        const { breaks, totalBreakMinutes, activeMinutes, workPeriods } =
            TimestampParser.calculateBreaksAlternating(timestamps, referenceTime);

        // Get required work hours
        const requiredWorkHours = parseFloat(this.workHoursInput.value) || 6;
        const requiredWorkMinutes = requiredWorkHours * 60;

        let logoutTimeFormatted = "--:--";
        let remainingActiveMinutes = 0;
        let isComplete = false;

        if (isToday) {
            // Live mode: calculate when to logout
            remainingActiveMinutes = Math.max(0, requiredWorkMinutes - activeMinutes);
            const logoutDate = new Date(now.getTime() + remainingActiveMinutes * 60000);

            const logoutHours = String(logoutDate.getHours()).padStart(2, '0');
            const logoutMinutes = String(logoutDate.getMinutes()).padStart(2, '0');
            logoutTimeFormatted = `${logoutHours}:${logoutMinutes}`;
            isComplete = remainingActiveMinutes <= 0;
        } else {
            // History mode: just show what was worked
            const lastHours = String(lastTimestamp.getHours()).padStart(2, '0');
            const lastMinutes = String(lastTimestamp.getMinutes()).padStart(2, '0');
            logoutTimeFormatted = `${lastHours}:${lastMinutes} (End)`;
            remainingActiveMinutes = 0;
            isComplete = true; // It's in the past, so it's "complete"
        }

        // Calculate total office time (from first to reference time)
        const loginTime = timestamps[0];
        const totalOfficeMinutes = Math.max(0, (referenceTime - loginTime) / (1000 * 60));

        // Calculate progress
        const progressPercent = Math.min(100, Math.max(0, (activeMinutes / requiredWorkMinutes) * 100));

        // Update UI
        this.updateResults({
            logoutTime: logoutTimeFormatted,
            activeMinutes: activeMinutes,
            breakMinutes: totalBreakMinutes,
            remainingMinutes: remainingActiveMinutes,
            progressPercent: progressPercent,
            totalOfficeMinutes: totalOfficeMinutes,
            isComplete: isComplete,
            breakCount: breaks.length,
            isHistory: !isToday
        });

        // Display breakdown
        this.displayBreakdown(workPeriods, breaks);

        // Store data for live updates (only if it's today)
        this.currentCalculation = isToday ? {
            mode: 'timestamp',
            timestamps,
            breaks,
            requiredWorkMinutes,
            loginTime,
            workPeriods
        } : null;
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

        // Helper function to format duration to HH:mm
        const formatDuration = (totalMinutes) => {
            const h = Math.floor(Math.abs(totalMinutes) / 60);
            const m = Math.round(Math.abs(totalMinutes) % 60);
            return `${h}:${String(m).padStart(2, '0')}`;
        };

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
            value.textContent = formatDuration(period.minutes);

            item.appendChild(label);
            item.appendChild(value);
            breakdownContent.appendChild(item);
        });
    }

    updateResults(data) {
        // Activate result card
        this.resultCard.classList.add('active');

        // Update logout time or History label
        const resultHeader = this.resultCard.querySelector('.result-header h3');
        if (data.isHistory) {
            resultHeader.textContent = 'Shift Summary (Past)';
            this.resultTime.textContent = data.logoutTime; // This will show "HH:MM (End)"
        } else {
            resultHeader.textContent = 'Your Logout Time';
            this.resultTime.textContent = data.logoutTime;
        }

        // Helper to format HH:mm
        const toHHMM = (totalMinutes) => {
            const h = Math.floor(totalMinutes / 60);
            const m = Math.round(totalMinutes % 60);
            return `${h}:${String(m).padStart(2, '0')}`;
        };

        // Update details
        this.activeWorkTime.textContent = toHHMM(data.activeMinutes);

        // Update break time
        this.breakTime.textContent = toHHMM(data.breakMinutes);

        // Update time remaining
        const remainingLabel = this.resultCard.querySelector('.detail-item:nth-child(3) .detail-label');
        if (data.isHistory) {
            remainingLabel.textContent = 'Status';
            this.timeRemaining.textContent = 'Shift Processed';
            this.timeRemaining.style.color = 'var(--color-text-secondary)';
        } else if (data.isComplete) {
            remainingLabel.textContent = 'Time Remaining';
            this.timeRemaining.textContent = 'Work Complete! 🎉';
            this.timeRemaining.style.color = 'var(--color-accent-green)';
        } else {
            remainingLabel.textContent = 'Time Remaining';
            this.timeRemaining.textContent = toHHMM(data.remainingMinutes);
            this.timeRemaining.style.color = 'var(--color-text-primary)';
        }

        // Update total office time
        this.totalOfficeTime.textContent = toHHMM(data.totalOfficeMinutes);

        // Update progress bar
        this.progressFill.style.width = `${data.progressPercent}%`;
        const progressPrefix = data.isHistory ? 'Shift work' : 'Day progress';
        this.progressText.textContent = `${progressPrefix}: ${Math.round(data.progressPercent)}%`;

        // Store current data
        this.currentData = data;

        // Check for alarms if not history
        if (!data.isHistory) {
            this.checkAlarm(data.remainingMinutes, data.isComplete);
        }

        // Add celebration effect if complete and NOT history
        if (data.isComplete && !data.isHistory && !this.celebrationShown) {
            this.celebrate();
            this.celebrationShown = true;
        } else if (!data.isComplete) {
            this.celebrationShown = false;
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
