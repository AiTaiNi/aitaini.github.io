(function () {
    var KEY = 'daily-tasks-v1';
    var state = { tasks: [], done: {} };

    try {
        var raw = localStorage.getItem(KEY);

        if (raw) {
            var p = JSON.parse(raw);

            if (p && p.tasks && p.done) state = p;
        }
    } catch (e) {
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch (e) {
        }
    }

    if (!Array.isArray(state.events)) state.events = [];

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function dkey(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    var todayKey = dkey(new Date());
    var sel = todayKey;
    var view = new Date();
    view.setDate(1);

    if (!state.tasks.length && !Object.keys(state.done).length) {
        var s = todayKey;

        state.tasks = [{ id: 't1', name: 'Drink water', since: s }, { id: 't2', name: 'Exercise', since: s }, { id: 't3', name: 'Read for 20 minutes', since: s }];
    }

    function tasksFor(k) {
        return state.tasks.filter(function (t) {
            return t.since <= k;
        });
    }

    function doneFor(k) {
        var d = state.done[k] || [];

        return tasksFor(k).filter(function (t) {
            return d.indexOf(t.id) > -1;
        }).length;
    }

    function color(frac) {
        return 'hsl(' + Math.round(frac * 120) + ',70%,' + (frac > 0.4 && frac < 0.75 ? '62%' : '60%') + ')';
    }

    var dows = document.getElementById('dows');

    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (n) {
        var e = document.createElement('div');
        e.className = 'dow';
        e.textContent = n;
        dows.appendChild(e);
    });

    var REPS = { none: 'once', week: 'weekly', month: 'monthly', year: 'yearly' };
    var ICONS = [['star', '★'], ['heart', '♥'], ['flag', '⚑'], ['plane', '✈'], ['mail', '✉'], ['phone', '☎'], ['music', '♫'], ['alert', '⚠'], ['scissors', '✂'], ['pen', '✎'], ['home', '⌂'], ['gear', '⚙'], ['money', '$'], ['plus', '✚'], ['umbrella', '☂'], ['moon', '☾'], ['flower', '✿'], ['crown', '♛'], ['spark', '✦'], ['key', '⚿']];

    function occurs(e, k) {
        if (k < e.date) return false;

        if (e.rep === 'none') return k === e.date;

        var a = e.date.split('-').map(Number), b = k.split('-').map(Number);

        if (e.rep === 'week') return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5) % 7 === 0;

        var dim = new Date(b[0], b[1], 0).getDate();

        if (e.rep === 'month') return b[2] === Math.min(a[2], dim);

        if (e.rep === 'year') return b[1] === a[1] && b[2] === (a[1] === 2 && a[2] === 29 ? dim : a[2]);

        return false;
    }

    function eventsFor(k) {
        return state.events.filter(function (e) {
            return occurs(e, k);
        }).sort(function (x, y) {
            return x.name.localeCompare(y.name);
        });
    }

    function evLabel(e) {
        return (e.icon ? e.icon + ' ' : '') + e.name + (e.rep !== 'none' ? ' (' + REPS[e.rep] + ')' : '');
    }

    var iconBox = document.getElementById('icons');

    ICONS.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = p[1] + '\uFE0E';
        b.title = p[0];
        b.setAttribute('aria-label', 'Icon ' + p[0]);

        b.onclick = function () {
            document.getElementById('evIcon').value = p[1] + '\uFE0E';
        };

        iconBox.appendChild(b);
    });

    document.getElementById('evDate').value = todayKey;

    function renderEvs() {
        var box = document.getElementById('evs');
        box.innerHTML = '';

        var list = eventsFor(sel);

        if (!list.length) return;

        var h = document.createElement('p');
        h.className = 'sub';
        h.textContent = 'Events';
        box.appendChild(h);

        list.forEach(function (e) {
            var r = document.createElement('div');
            r.className = 'ev';

            var i = document.createElement('i');
            i.textContent = e.icon || '•';

            var n = document.createElement('span');
            n.textContent = e.name;

            var m = document.createElement('em');
            m.textContent = REPS[e.rep];

            var b = document.createElement('button');
            b.textContent = e.rep === 'none' ? 'Remove' : 'Remove series';
            b.setAttribute('aria-label', 'Remove ' + e.name);

            b.onclick = function () {
                if (editing === e.id) stopEdit();

                state.events = state.events.filter(function (x) {
                    return x.id !== e.id;
                });

                save();
                render();
            };

            var ed = document.createElement('button');
            ed.textContent = 'Edit';
            ed.style.marginLeft = 'auto';
            b.style.marginLeft = '0';
            ed.setAttribute('aria-label', 'Edit ' + e.name);

            ed.onclick = function () {
                startEdit(e);
            };

            r.appendChild(i);
            r.appendChild(n);
            r.appendChild(m);
            r.appendChild(ed);
            r.appendChild(b);
            box.appendChild(r);
        });
    }

    var editing = null;

    function startEdit(e) {
        editing = e.id;
        document.getElementById('evName').value = e.name;
        document.getElementById('evDate').value = e.date;
        document.getElementById('evRep').value = e.rep;
        document.getElementById('evIcon').value = e.icon || '';

        document.getElementById('evTitle').textContent = 'Edit event (changes every repeat)';
        document.getElementById('evAdd').textContent = 'Save changes';
        document.getElementById('evCancel').hidden = false;
        document.getElementById('evName').focus();
    }

    function stopEdit() {
        editing = null;
        document.getElementById('evName').value = '';
        document.getElementById('evIcon').value = '';
        document.getElementById('evDate').value = sel;

        document.getElementById('evTitle').textContent = 'Add an event';
        document.getElementById('evAdd').textContent = 'Add event';
        document.getElementById('evCancel').hidden = true;
    }

    function addEvent() {
        var name = document.getElementById('evName').value.trim(), date = document.getElementById('evDate').value;

        if (!name || !DATE.test(date)) return;

        var ev = editing ? state.events.filter(function (x) {
            return x.id === editing;
        })[0] : null;

        var data = { name: name.slice(0, 60), date: date, rep: document.getElementById('evRep').value, icon: document.getElementById('evIcon').value.trim().slice(0, 3) };

        if (ev) {
            Object.assign(ev, data);
        } else {
            state.events.push(Object.assign({ id: 'e' + Date.now() }, data));
        }

        sel = date;

        var p = date.split('-');

        view = new Date(+p[0], +p[1] - 1, 1);
        stopEdit();
        save();
        render();
    }
    document.getElementById('evAdd').onclick = addEvent;
    document.getElementById('evCancel').onclick = stopEdit;

    document.getElementById('evName').onkeydown = function (e) {
        if (e.key === 'Enter') addEvent();
    };

    function renderCal() {
        var y = view.getFullYear(), m = view.getMonth();

        document.getElementById('month').textContent = view.toLocaleString(undefined, { month: 'long', year: 'numeric' });

        var cal = document.getElementById('cal');
        cal.innerHTML = '';

        var first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();

        for (var i = 0; i < first; i++) {
            var b = document.createElement('div');
            b.className = 'day empty';
            cal.appendChild(b);
        }

        for (var d = 1; d <= days; d++) {
            var k = y + '-' + pad(m + 1) + '-' + pad(d);
            var el = document.createElement('div');
            el.className = 'day';
            el.textContent = d;

            var total = tasksFor(k).length;

            if (k <= todayKey && total > 0) {
                el.className += ' graded';
                el.style.background = color(doneFor(k) / total);
            }

            if (k === todayKey) el.className += ' today';

            if (k === sel) el.className += ' sel';

            var evs = eventsFor(k);

            if (evs.length) {
                el.className += ' has';
                el.title = evs.map(evLabel).join('\n');

                var ic = evs.filter(function (e) {
                    return e.icon;
                });

                if (ic.length) {
                    var mk = document.createElement('span');
                    mk.className = 'mk';

                    mk.textContent = ic.slice(0, 2).map(function (e) {
                        return e.icon;
                    }).join('') + (ic.length > 2 ? '+' + (ic.length - 2) : '');

                    el.appendChild(mk);
                }
            }

            el.setAttribute('aria-label', d + ' ' + view.toLocaleString(undefined, { month: 'long' }) + (evs.length ? ', ' + evs.length + ' events' : ''));
            el.setAttribute('role', 'button');

            el.onclick = (function (kk) {
                return function () {
                    sel = kk;
                    document.getElementById('evDate').value = kk;
                    render();
                };
            })(k);

            cal.appendChild(el);
        }
    }

    function renderDay() {
        var parts = sel.split('-'), dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        var title = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

        document.getElementById('dayTitle').textContent = sel === todayKey ? 'Today · ' + title : title;

        var list = tasksFor(sel), n = doneFor(sel), box = document.getElementById('checks');

        document.getElementById('dayCount').textContent = n + ' / ' + list.length + ' done';

        var prog = document.getElementById('prog'), frac = list.length ? n / list.length : 0;

        prog.style.width = (frac * 100) + '%';
        prog.style.background = color(frac);

        box.innerHTML = '';

        if (!list.length) {
            var p = document.createElement('p');
            p.className = 'note';
            p.textContent = 'No tasks for this day.';
            box.appendChild(p);

            return;
        }

        var d = state.done[sel] || [];

        list.forEach(function (t) {
            var lab = document.createElement('label');
            lab.className = 't' + (d.indexOf(t.id) > -1 ? ' done' : '');

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = d.indexOf(t.id) > -1;

            cb.onchange = function () {
                var arr = (state.done[sel] || []).slice(), i = arr.indexOf(t.id);

                if (cb.checked && i < 0) arr.push(t.id);

                if (!cb.checked && i > -1) arr.splice(i, 1);

                state.done[sel] = arr;
                save();
                render();
            };

            var sp = document.createElement('span');
            sp.textContent = t.name;
            lab.appendChild(cb);
            lab.appendChild(sp);
            box.appendChild(lab);
        });
    }

    function renderManage() {
        var box = document.getElementById('manage');
        box.innerHTML = '';

        if (!state.tasks.length) {
            var p = document.createElement('p');
            p.className = 'note';
            p.textContent = 'Add your first daily task above.';
            box.appendChild(p);

            return;
        }

        state.tasks.forEach(function (t) {
            var r = document.createElement('div');
            r.className = 'trow';

            var s = document.createElement('span');
            s.textContent = t.name;

            var b = document.createElement('button');
            b.textContent = 'Remove';
            b.setAttribute('aria-label', 'Remove ' + t.name);

            b.onclick = function () {
                state.tasks = state.tasks.filter(function (x) {
                    return x.id !== t.id;
                });

                save();
                render();
            };

            r.appendChild(s);
            r.appendChild(b);
            box.appendChild(r);
        });
    }

    function render() {
        renderCal();
        renderDay();
        renderEvs();
        renderManage();
    }

    function addTask() {
        var inp = document.getElementById('newTask'), name = inp.value.trim();

        if (!name) return;

        state.tasks.push({ id: 't' + Date.now(), name: name, since: todayKey });
        inp.value = '';
        save();
        render();
    }
    document.getElementById('addBtn').onclick = addTask;

    document.getElementById('newTask').onkeydown = function (e) {
        if (e.key === 'Enter') addTask();
    };

    document.getElementById('prev').onclick = function () {
        view.setMonth(view.getMonth() - 1);
        renderCal();
    };

    document.getElementById('next').onclick = function () {
        view.setMonth(view.getMonth() + 1);
        renderCal();
    };

    /* ---------- import / export ---------- */
    var msg = document.getElementById('dataMsg'), area = document.getElementById('dataText'), actions = document.getElementById('impActions'), pending = null, DATE = /^\d{4}-\d{2}-\d{2}$/;

    function say(t) {
        msg.textContent = t;
    }

    function saveFile(name, data) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: /\.csv$/.test(name) ? 'text/csv' : 'application/json' }));
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(function () {
            URL.revokeObjectURL(a.href);
        }, 1000);

        say('Saved ' + name + '.');
    }
    document.getElementById('expEv').onclick = function () {
        var rows = ['date,name,repeat,icon'];

        state.events.forEach(function (e) {
            rows.push(e.date + ',' + q(e.name) + ',' + e.rep + ',' + q(e.icon || ''));
        });

        saveFile('events-' + todayKey + '.csv', rows.join('\n'));
    };

    document.getElementById('expJson').onclick = function () {
        var out = { app: 'daily-tasks', version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks, done: state.done, events: state.events };

        saveFile('daily-tasks-' + todayKey + '.json', JSON.stringify(out, null, 2));
    };

    function q(s) {
        return '"' + String(s).replace(/"/g, '""') + '"';
    }
    document.getElementById('expCsv').onclick = function () {
        var rows = ['date,task,done'];

        if (state.tasks.length) {
            var min = state.tasks.reduce(function (a, t) {
                return t.since < a ? t.since : a;
            }, todayKey);

            var p = min.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);

            while (dkey(d) <= todayKey) {
                var k = dkey(d), dn = state.done[k] || [];

                tasksFor(k).forEach(function (t) {
                    rows.push(k + ',' + q(t.name) + ',' + (dn.indexOf(t.id) > -1 ? 1 : 0));
                });

                d.setDate(d.getDate() + 1);
            }
        }

        saveFile('daily-tasks-history-' + todayKey + '.csv', rows.join('\n'));
    };

    function parse(text) {
        var o;

        try {
            o = JSON.parse(text);
        } catch (e) {
            return null;
        }

        if (!o || !Array.isArray(o.tasks) || !o.done || typeof o.done !== 'object' || Array.isArray(o.done)) return null;

        var tasks = [], done = {};

        o.tasks.forEach(function (t) {
            if (t && typeof t.id === 'string' && typeof t.name === 'string' && DATE.test(t.since || ''))
                tasks.push({ id: t.id.slice(0, 40), name: t.name.slice(0, 80), since: t.since });
        });

        Object.keys(o.done).forEach(function (k) {
            if (DATE.test(k) && Array.isArray(o.done[k]))
                done[k] = o.done[k].filter(function (x) {
                    return typeof x === 'string';
                });
        });

        var events = [];

        (Array.isArray(o.events) ? o.events : []).forEach(function (e) {
            if (e && typeof e.id === 'string' && typeof e.name === 'string' && DATE.test(e.date || '') && REPS[e.rep])
                events.push({ id: e.id.slice(0, 40), name: e.name.slice(0, 60), date: e.date, rep: e.rep, icon: typeof e.icon === 'string' ? e.icon.slice(0, 3) : '' });
        });

        return { tasks: tasks, done: done, events: events };
    }

    function stage(text) {
        pending = parse(text);

        if (!pending) {
            actions.hidden = true;
            say('That doesn’t look like a Daily Tasks export.');

            return;
        }

        say('Found ' + pending.tasks.length + ' tasks, ' + pending.events.length + ' events and ' + Object.keys(pending.done).length + ' days of history. How should it be imported?');
        actions.hidden = false;
    }

    function finish(t) {
        pending = null;
        actions.hidden = true;
        area.hidden = true;
        area.value = '';
        save();
        render();
        say(t);
    }

    document.getElementById('impFile').onclick = function () {
        document.getElementById('fileIn').click();
    };

    document.getElementById('fileIn').onchange = function (e) {
        var f = e.target.files && e.target.files[0];

        if (!f) return;

        var r = new FileReader();

        r.onload = function () {
            stage(String(r.result));
        };

        r.onerror = function () {
            say('Couldn’t read that file.');
        };

        r.readAsText(f);
        e.target.value = '';
    };

    document.getElementById('impPaste').onclick = function () {
        if (area.hidden) {
            area.hidden = false;
            area.value = '';
            area.focus();
            say('Paste exported JSON, then press the button again.');

            return;
        }

        if (area.value.trim()) {
            stage(area.value);
        } else {
            area.hidden = true;
        }
    };

    document.getElementById('doMerge').onclick = function () {
        if (!pending) return;

        var ids = {};

        state.tasks.forEach(function (t) {
            ids[t.id] = 1;
        });

        pending.tasks.forEach(function (t) {
            if (!ids[t.id]) state.tasks.push(t);
        });

        Object.keys(pending.done).forEach(function (k) {
            var cur = state.done[k] || [];

            pending.done[k].forEach(function (id) {
                if (cur.indexOf(id) < 0) cur.push(id);
            });

            state.done[k] = cur;
        });

        var eids = {};

        state.events.forEach(function (e) {
            eids[e.id] = 1;
        });

        pending.events.forEach(function (e) {
            if (!eids[e.id]) state.events.push(e);
        });

        finish('Merged into your current data.');
    };

    document.getElementById('doReplace').onclick = function () {
        if (!pending) return;

        state = { tasks: pending.tasks, done: pending.done, events: pending.events };
        finish('Replaced with imported data.');
    };

    document.getElementById('doCancel').onclick = function () {
        pending = null;
        actions.hidden = true;
        say('Import cancelled.');
    };

    /* ---------- file chooser (File System Access API) ---------- */
    var saveAsBtn = document.getElementById('saveAs'), openBtn = document.getElementById('openPick');
    var jsonTypes = [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }];

    if (typeof window.showSaveFilePicker !== 'function') {
        saveAsBtn.hidden = true;
    }

    if (typeof window.showOpenFilePicker !== 'function') {
        openBtn.hidden = true;
    }

    function pickerError(e) {
        if (e && e.name === 'AbortError') {
            say('Cancelled.');
        } else {
            say('The file chooser isn’t available in this view. Use Export JSON or Import JSON… instead.');
        }
    }
    saveAsBtn.onclick = async function () {
        try {
            var h = await window.showSaveFilePicker({ suggestedName: 'daily-tasks-' + todayKey + '.json', types: jsonTypes });
            var w = await h.createWritable();

            await w.write(JSON.stringify({ app: 'daily-tasks', version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks, done: state.done, events: state.events }, null, 2));
            await w.close();
            say('Saved to ' + h.name + '.');
        } catch (e) {
            pickerError(e);
        }
    };

    openBtn.onclick = async function () {
        try {
            var hs = await window.showOpenFilePicker({ types: jsonTypes, multiple: false });
            var f = await hs[0].getFile();

            stage(await f.text());
        } catch (e) {
            pickerError(e);
        }
    };

    render();
})();
