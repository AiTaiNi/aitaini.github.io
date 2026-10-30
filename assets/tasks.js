/* Daily tasks, calendar events and countdowns, shared by personal/dashboard, personal/calendar and personal/today.
   All of them use the same synced key, so they always show the same tasks, history and events.
   Each part only runs when the page has its elements:
     #cal (+ #dows #month #prev #next #goToday)   month calendar, coloured by how much of each day was done
     #checks (+ #dayTitle #dayCount #prog)  checklist for the selected day (today when there's no calendar)
     #evs                                   events on the selected day
     #evAdd (+ #evName #evDate #evRep #evIcon #icons #evCd #evTitle #evCancel)   add/edit event form
     #newTask #newMax #addBtn #manage       add/remove daily tasks
     #countdowns                            events marked "show countdown" that are at most CD_DAYS away
     #evAll                                 every event, soonest first
     #expJson …                             backup import/export (dashboard settings)
   window.Tasks gives a read-only summary (today's progress, upcoming countdowns) for overview pages, plus
   syncEvents for pages that keep their own events on the calendar (personal/expenses: yearly payments) and
   syncTask/dropTask for pages that keep their own daily tasks (personal/learning/indonesian). */
(function () {
    var KEY = 'daily-tasks-v1';
    var CD_DAYS = 14;
    var DATE = /^\d{4}-\d{2}-\d{2}$/;
    var state = { tasks: [], done: {} };
    var p = Sync.get(KEY);

    function $(id) {
        return document.getElementById(id);
    }

    if (p && p.tasks && p.done) state = p;

    function save() {
        Sync.set(KEY, state);
    }

    function normalize() {
        if (!Array.isArray(state.events)) state.events = [];

        if (!state.counts || typeof state.counts !== 'object') state.counts = {};
    }

    normalize();

    /* First sync on a device that already has data: combine both copies instead of dropping one */
    var merge = {};

    merge[KEY] = function (local, remote) {
        var out = { tasks: (remote.tasks || []).slice(), done: Object.assign({}, remote.done), events: (remote.events || []).slice(), counts: Object.assign({}, remote.counts) };

        mergeInto(out, { tasks: local.tasks || [], done: local.done || {}, events: local.events || [], counts: local.counts || {} });

        return out;
    };

    Sync.use([KEY], { merge: merge });

    /* A newer copy arrived from another device or another page */
    Sync.on(KEY, function (v) {
        if (!v || !v.tasks || !v.done) return;

        state = v;
        normalize();
        render();
    });

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function dkey(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function addDays(k, n) {
        var a = k.split('-');

        return dkey(new Date(+a[0], +a[1] - 1, +a[2] + n));
    }

    function niceDate(k, opts) {
        var a = k.split('-');

        return new Date(+a[0], +a[1] - 1, +a[2]).toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
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

    /* Counter tasks have a target `max`; plain tasks count as 1 */
    function maxOf(t) {
        return t.max > 1 ? t.max : 1;
    }

    function countOf(t, k) {
        if ((state.done[k] || []).indexOf(t.id) > -1) return maxOf(t);

        return Math.min((state.counts[k] || {})[t.id] || 0, maxOf(t));
    }

    /* Share of the day done, weighting each task by its counter, e.g. 2/3 + 1/1 = 75% */
    function fracFor(k) {
        var got = 0, all = 0;

        tasksFor(k).forEach(function (t) {
            got += countOf(t, k);
            all += maxOf(t);
        });

        return all ? got / all : 0;
    }

    function setCount(t, k, n) {
        var m = maxOf(t), arr = (state.done[k] || []).slice(), i = arr.indexOf(t.id);

        n = Math.max(0, Math.min(m, n));

        if (m > 1) {
            var c = Object.assign({}, state.counts[k]);

            if (n) c[t.id] = n; else delete c[t.id];

            state.counts[k] = c;
        }

        if (n >= m && i < 0) arr.push(t.id);

        if (n < m && i > -1) arr.splice(i, 1);

        state.done[k] = arr;
        save();
        render();
    }

    function color(frac) {
        return 'hsl(' + Math.round(frac * 120) + ',70%,' + (frac > 0.4 && frac < 0.75 ? '62%' : '60%') + ')';
    }

    /* ---------- events ---------- */
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

    /* Days from today to the event's next occurrence, looking at most `limit` days ahead; -1 if none */
    function nextIn(e, limit) {
        for (var i = 0; i <= limit; i++) {
            if (occurs(e, addDays(todayKey, i))) return i;
        }

        return -1;
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

    function removeEvent(e) {
        if (editing === e.id) stopEdit();

        state.events = state.events.filter(function (x) {
            return x.id !== e.id;
        });

        save();
        render();
    }

    /* ⏱ toggle on each event row, so the countdown can be switched without opening the edit form */
    function cdButton(e) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cdt';
        b.textContent = '⏱\uFE0E';
        b.title = e.countdown ? 'Countdown on: shown when ' + CD_DAYS + ' days away or less. Click to turn off.' : 'Show a countdown';
        b.setAttribute('aria-pressed', e.countdown ? 'true' : 'false');
        b.setAttribute('aria-label', 'Countdown for ' + e.name);

        b.onclick = function () {
            if (e.countdown) delete e.countdown; else e.countdown = true;

            save();
            render();
        };

        return b;
    }

    /* One event row: icon, name, detail, then countdown / edit / remove */
    function evRow(e, detail) {
        var r = document.createElement('div');
        r.className = 'ev';

        var i = document.createElement('i');
        i.textContent = e.icon || '•';

        var n = document.createElement('span');
        n.textContent = e.name;

        var m = document.createElement('em');
        m.textContent = detail;

        var acts = document.createElement('div');
        acts.className = 'evacts';
        acts.appendChild(cdButton(e));

        if ($('evAdd')) {
            var ed = document.createElement('button');
            ed.type = 'button';
            ed.textContent = 'Edit';
            ed.setAttribute('aria-label', 'Edit ' + e.name);

            ed.onclick = function () {
                startEdit(e);
            };

            acts.appendChild(ed);
        }

        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.rep === 'none' ? 'Remove' : 'Remove series';
        b.setAttribute('aria-label', 'Remove ' + e.name);

        b.onclick = function () {
            removeEvent(e);
        };

        acts.appendChild(b);
        r.appendChild(i);
        r.appendChild(n);
        r.appendChild(m);
        r.appendChild(acts);

        return r;
    }

    function renderEvs() {
        var box = $('evs');
        box.innerHTML = '';

        var list = eventsFor(sel);

        if (!list.length) return;

        var h = document.createElement('p');
        h.className = 'sub';
        h.textContent = 'Events';
        box.appendChild(h);

        list.forEach(function (e) {
            box.appendChild(evRow(e, REPS[e.rep]));
        });
    }

    function renderAll() {
        var box = $('evAll');
        box.innerHTML = '';

        if (!state.events.length) {
            var p = document.createElement('p');
            p.className = 'note';
            p.textContent = 'No events yet.';
            box.appendChild(p);

            return;
        }

        /* Upcoming first, soonest first; one-time events that are over go last */
        state.events.map(function (e) {
            return { e: e, n: nextIn(e, 400) };
        }).sort(function (a, b) {
            return (a.n < 0) - (b.n < 0) || a.n - b.n || a.e.name.localeCompare(b.e.name);
        }).forEach(function (x) {
            var when = x.n < 0 ? 'past' : x.n === 0 ? 'today' : x.n === 1 ? 'tomorrow' : 'next ' + niceDate(addDays(todayKey, x.n));

            box.appendChild(evRow(x.e, REPS[x.e.rep] + ' · ' + when));
        });
    }

    function renderCountdowns() {
        var box = $('countdowns');
        box.innerHTML = '';

        var list = state.events.filter(function (e) {
            return e.countdown;
        }).map(function (e) {
            return { e: e, n: nextIn(e, CD_DAYS) };
        }).filter(function (x) {
            return x.n >= 0;
        }).sort(function (a, b) {
            return a.n - b.n || a.e.name.localeCompare(b.e.name);
        });

        if (!list.length) {
            var p = document.createElement('p');
            p.className = 'note';
            p.textContent = 'Nothing in the next ' + CD_DAYS + ' days. Turn on ⏱ for an event to count down to it.';
            box.appendChild(p);

            return;
        }

        list.forEach(function (x) {
            var r = document.createElement('div');
            r.className = 'cd' + (x.n === 0 ? ' now' : '');

            var num = document.createElement('b');
            num.textContent = x.n === 0 ? 'Today' : x.n === 1 ? '1 day' : x.n + ' days';

            var name = document.createElement('span');
            name.textContent = (x.e.icon ? x.e.icon + ' ' : '') + x.e.name;

            var d = document.createElement('em');
            d.textContent = niceDate(addDays(todayKey, x.n));

            r.appendChild(num);
            r.appendChild(name);
            r.appendChild(d);
            box.appendChild(r);
        });
    }

    /* ---------- event form ---------- */
    var editing = null;

    function startEdit(e) {
        editing = e.id;
        $('evName').value = e.name;
        $('evDate').value = e.date;
        $('evRep').value = e.rep;
        $('evIcon').value = e.icon || '';

        if ($('evCd')) $('evCd').checked = !!e.countdown;

        $('evTitle').textContent = 'Edit event (changes every repeat)';
        $('evAdd').textContent = 'Save changes';
        $('evCancel').hidden = false;
        $('evName').focus();
    }

    function stopEdit() {
        editing = null;
        $('evName').value = '';
        $('evIcon').value = '';
        $('evDate').value = sel;

        if ($('evCd')) $('evCd').checked = false;

        $('evTitle').textContent = 'Add an event';
        $('evAdd').textContent = 'Add event';
        $('evCancel').hidden = true;
    }

    function addEvent() {
        var name = $('evName').value.trim(), date = $('evDate').value;

        if (!name || !DATE.test(date)) return;

        var ev = editing ? state.events.filter(function (x) {
            return x.id === editing;
        })[0] : null;

        var data = { name: name.slice(0, 60), date: date, rep: $('evRep').value, icon: $('evIcon').value.trim().slice(0, 3) };

        if (ev) {
            Object.assign(ev, data);
        } else {
            ev = Object.assign({ id: 'e' + Date.now() }, data);
            state.events.push(ev);
        }

        if ($('evCd')) {
            if ($('evCd').checked) ev.countdown = true; else delete ev.countdown;
        }

        sel = date;

        var p = date.split('-');

        view = new Date(+p[0], +p[1] - 1, 1);
        stopEdit();
        save();
        render();
    }

    if ($('evAdd')) {
        ICONS.forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = p[1] + '\uFE0E';
            b.title = p[0];
            b.setAttribute('aria-label', 'Icon ' + p[0]);

            b.onclick = function () {
                $('evIcon').value = p[1] + '\uFE0E';
            };

            $('icons').appendChild(b);
        });

        $('evDate').value = todayKey;
        $('evAdd').onclick = addEvent;
        $('evCancel').onclick = stopEdit;

        $('evName').onkeydown = function (e) {
            if (e.key === 'Enter') addEvent();
        };
    }

    /* ---------- calendar ---------- */
    function renderCal() {
        var y = view.getFullYear(), m = view.getMonth();

        $('month').textContent = view.toLocaleString(undefined, { month: 'long', year: 'numeric' });

        /* Only useful when away from today */
        if ($('goToday')) $('goToday').disabled = sel === todayKey && y === new Date().getFullYear() && m === new Date().getMonth();

        var cal = $('cal');
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
                el.style.background = color(fracFor(k));
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

                    if ($('evDate') && !editing) $('evDate').value = kk;

                    render();
                };
            })(k);

            cal.appendChild(el);
        }
    }

    if ($('cal')) {
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (n) {
            var e = document.createElement('div');
            e.className = 'dow';
            e.textContent = n;
            $('dows').appendChild(e);
        });

        $('prev').onclick = function () {
            view.setMonth(view.getMonth() - 1);
            renderCal();
        };

        $('next').onclick = function () {
            view.setMonth(view.getMonth() + 1);
            renderCal();
        };

        /* Back to the current month, with today selected */
        if ($('goToday')) {
            $('goToday').onclick = function () {
                view = new Date();
                view.setDate(1);
                sel = todayKey;

                if ($('evDate') && !editing) $('evDate').value = todayKey;

                render();
            };
        }
    }

    /* ---------- day checklist ---------- */
    function renderDay() {
        if ($('dayTitle')) {
            var title = niceDate(sel, { weekday: 'long', month: 'short', day: 'numeric' });

            $('dayTitle').textContent = sel === todayKey ? 'Today · ' + title : title;
        }

        var list = tasksFor(sel), n = doneFor(sel), box = $('checks'), frac = fracFor(sel);

        if ($('dayCount')) $('dayCount').textContent = n + ' / ' + list.length + ' done';

        if ($('prog')) {
            $('prog').style.width = (frac * 100) + '%';
            $('prog').style.background = color(frac);
        }

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
                setCount(t, sel, cb.checked ? maxOf(t) : 0);
            };

            var sp = document.createElement('span');
            sp.textContent = t.name;
            lab.appendChild(cb);
            lab.appendChild(sp);

            if (maxOf(t) > 1) {
                var c = countOf(t, sel), ctr = document.createElement('div');
                ctr.className = 'ctr';

                [['−', -1, 'Decrease '], ['+', 1, 'Increase ']].forEach(function (b, j) {
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = b[0];
                    btn.setAttribute('aria-label', b[2] + t.name);
                    btn.disabled = b[1] < 0 ? c <= 0 : c >= maxOf(t);

                    btn.onclick = function (e) {
                        e.preventDefault();
                        setCount(t, sel, c + b[1]);
                    };

                    if (j) {
                        var v = document.createElement('b');
                        v.textContent = c + '/' + maxOf(t);
                        ctr.appendChild(v);
                    }

                    ctr.appendChild(btn);
                });

                lab.appendChild(ctr);
            }

            box.appendChild(lab);
        });
    }

    /* ---------- managing daily tasks ---------- */
    function renderManage() {
        var box = $('manage');
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
            s.textContent = t.name + (maxOf(t) > 1 ? ' · ×' + maxOf(t) : '');

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

    function addTask() {
        var inp = $('newTask'), name = inp.value.trim(), mx = $('newMax'), m = Math.min(99, parseInt(mx.value, 10) || 1);

        if (!name) return;

        var t = { id: 't' + Date.now(), name: name, since: todayKey };

        if (m > 1) t.max = m;

        state.tasks.push(t);
        inp.value = '';
        mx.value = '';
        save();
        render();
    }

    if ($('newTask')) {
        $('addBtn').onclick = addTask;

        $('newTask').onkeydown = $('newMax').onkeydown = function (e) {
            if (e.key === 'Enter') addTask();
        };
    }

    function render() {
        if ($('cal')) renderCal();

        if ($('checks')) renderDay();

        if ($('evs')) renderEvs();

        if ($('manage')) renderManage();

        if ($('countdowns')) renderCountdowns();

        if ($('evAll')) renderAll();

        listeners.forEach(function (fn) {
            fn();
        });
    }

    /* Read-only summary for pages that only show an overview (personal/index.html) */
    var listeners = [];

    window.Tasks = {
        today: function () {
            return { done: doneFor(todayKey), total: tasksFor(todayKey).length, frac: fracFor(todayKey) };
        },

        /* Events with the countdown on, at most CD_DAYS away: [{ name, icon, days }] soonest first */
        countdowns: function () {
            return state.events.filter(function (e) {
                return e.countdown;
            }).map(function (e) {
                return { name: e.name, icon: e.icon || '', days: nextIn(e, CD_DAYS) };
            }).filter(function (x) {
                return x.days >= 0;
            }).sort(function (a, b) {
                return a.days - b.days;
            });
        },

        onChange: function (fn) {
            listeners.push(fn);
        },

        /* Events kept up to date by another page (the Expenses page's yearly payments): every event whose id starts
           with `prefix` is replaced by `list` ([{ id, name, date, rep, icon }]). Missing ones are added with the
           countdown on, name/date/repeat follow the list, and an icon or countdown changed on the Calendar is kept.
           Call it after Sync.ready(), so an older copy on this device can't overwrite newer events. */
        syncEvents: function (prefix, list) {
            var want = {}, changed = false;

            list.forEach(function (e) {
                want[e.id] = e;
            });

            state.events = state.events.filter(function (e) {
                var keep = e.id.indexOf(prefix) !== 0 || want[e.id];

                if (!keep) changed = true;

                return keep;
            });

            list.forEach(function (w) {
                var e = state.events.filter(function (x) {
                    return x.id === w.id;
                })[0];

                if (!e) {
                    state.events.push({ id: w.id, name: w.name.slice(0, 60), date: w.date, rep: w.rep, icon: w.icon || '', countdown: true });
                    changed = true;
                } else if (e.name !== w.name.slice(0, 60) || e.date !== w.date || e.rep !== w.rep) {
                    e.name = w.name.slice(0, 60);
                    e.date = w.date;
                    e.rep = w.rep;
                    changed = true;
                }
            });

            if (changed) {
                save();
                render();
            }

            return changed;
        },

        /* A daily task kept by another page (the Indonesian pages: reviews done, 15-minute study blocks). Adds it
           (from today) if it's missing, keeps its name and target in step, and raises today's count to n. Counts
           only go up, so a page never undoes a tick made on the Calendar. Call it after Sync.ready(). */
        syncTask: function (def, n) {
            var t = state.tasks.filter(function (x) {
                return x.id === def.id;
            })[0], changed = false, m = def.max > 1 ? def.max : 1;

            if (!t) {
                t = { id: def.id, name: def.name, since: todayKey };
                state.tasks.push(t);
                changed = true;
            }

            if (t.name !== def.name || maxOf(t) !== m) {
                t.name = def.name;

                if (m > 1) t.max = m; else delete t.max;

                changed = true;
            }

            if (Math.min(n, m) > countOf(t, todayKey)) return setCount(t, todayKey, n);

            if (changed) {
                save();
                render();
            }
        },

        /* Removes a page-owned task (the history of past days stays in the data) */
        dropTask: function (id) {
            var before = state.tasks.length;

            state.tasks = state.tasks.filter(function (x) {
                return x.id !== id;
            });

            if (state.tasks.length !== before) {
                save();
                render();
            }
        }
    };

    /* A page left open past midnight moves on to the new day when it's looked at again */
    document.addEventListener('visibilitychange', function () {
        var k = dkey(new Date());

        if (document.hidden || k === todayKey) return;

        if (sel === todayKey) sel = k;

        todayKey = k;
        render();
    });

    /* Adds tasks, history and events from `from` that `into` doesn't have yet */
    function mergeInto(into, from) {
        var ids = {};

        into.tasks.forEach(function (t) {
            ids[t.id] = 1;
        });

        from.tasks.forEach(function (t) {
            if (!ids[t.id]) into.tasks.push(t);
        });

        Object.keys(from.done).forEach(function (k) {
            var cur = (into.done[k] || []).slice();

            from.done[k].forEach(function (id) {
                if (cur.indexOf(id) < 0) cur.push(id);
            });

            into.done[k] = cur;
        });

        if (!into.counts) into.counts = {};

        /* For counters, keep the higher count of the two copies */
        Object.keys(from.counts || {}).forEach(function (k) {
            var cur = Object.assign({}, into.counts[k]);

            Object.keys(from.counts[k]).forEach(function (id) {
                if (!(cur[id] >= from.counts[k][id])) cur[id] = from.counts[k][id];
            });

            into.counts[k] = cur;
        });

        var eids = {};

        into.events.forEach(function (e) {
            eids[e.id] = 1;
        });

        from.events.forEach(function (e) {
            if (!eids[e.id]) into.events.push(e);
        });
    }

    /* ---------- import / export (dashboard settings) ---------- */
    if ($('expJson')) {
        var msg = $('dataMsg'), area = $('dataText'), actions = $('impActions'), pending = null;

        var say = function (t) {
            msg.textContent = t;
        };

        var q = function (s) {
            return '"' + String(s).replace(/"/g, '""') + '"';
        };

        var exportJson = function () {
            return JSON.stringify({ app: 'daily-tasks', version: 3, exportedAt: new Date().toISOString(), tasks: state.tasks, done: state.done, counts: state.counts, events: state.events }, null, 2);
        };

        var saveFile = function (name, data) {
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
        };

        $('expEv').onclick = function () {
            var rows = ['date,name,repeat,icon,countdown'];

            state.events.forEach(function (e) {
                rows.push(e.date + ',' + q(e.name) + ',' + e.rep + ',' + q(e.icon || '') + ',' + (e.countdown ? 1 : 0));
            });

            saveFile('events-' + todayKey + '.csv', rows.join('\n'));
        };

        $('expJson').onclick = function () {
            saveFile('daily-tasks-' + todayKey + '.json', exportJson());
        };

        $('expCsv').onclick = function () {
            var rows = ['date,task,done,count,target'];

            if (state.tasks.length) {
                var min = state.tasks.reduce(function (a, t) {
                    return t.since < a ? t.since : a;
                }, todayKey);

                for (var k = min; k <= todayKey; k = addDays(k, 1)) {
                    var dn = state.done[k] || [];

                    tasksFor(k).forEach(function (t) {
                        rows.push(k + ',' + q(t.name) + ',' + (dn.indexOf(t.id) > -1 ? 1 : 0) + ',' + countOf(t, k) + ',' + maxOf(t));
                    });
                }
            }

            saveFile('daily-tasks-history-' + todayKey + '.csv', rows.join('\n'));
        };

        var parse = function (text) {
            var o;

            try {
                o = JSON.parse(text);
            } catch (e) {
                return null;
            }

            if (!o || !Array.isArray(o.tasks) || !o.done || typeof o.done !== 'object' || Array.isArray(o.done)) return null;

            var tasks = [], done = {};

            o.tasks.forEach(function (t) {
                if (t && typeof t.id === 'string' && typeof t.name === 'string' && DATE.test(t.since || '')) {
                    var nt = { id: t.id.slice(0, 40), name: t.name.slice(0, 80), since: t.since };

                    if (Number.isInteger(t.max) && t.max > 1) nt.max = Math.min(99, t.max);

                    tasks.push(nt);
                }
            });

            var counts = {};

            if (o.counts && typeof o.counts === 'object')
                Object.keys(o.counts).forEach(function (k) {
                    var c = o.counts[k], out = {};

                    if (!DATE.test(k) || !c || typeof c !== 'object') return;

                    Object.keys(c).forEach(function (id) {
                        if (Number.isInteger(c[id]) && c[id] > 0) out[id] = c[id];
                    });

                    counts[k] = out;
                });

            Object.keys(o.done).forEach(function (k) {
                if (DATE.test(k) && Array.isArray(o.done[k]))
                    done[k] = o.done[k].filter(function (x) {
                        return typeof x === 'string';
                    });
            });

            var events = [];

            (Array.isArray(o.events) ? o.events : []).forEach(function (e) {
                if (e && typeof e.id === 'string' && typeof e.name === 'string' && DATE.test(e.date || '') && REPS[e.rep]) {
                    var ne = { id: e.id.slice(0, 40), name: e.name.slice(0, 60), date: e.date, rep: e.rep, icon: typeof e.icon === 'string' ? e.icon.slice(0, 3) : '' };

                    if (e.countdown === true) ne.countdown = true;

                    events.push(ne);
                }
            });

            return { tasks: tasks, done: done, counts: counts, events: events };
        };

        var stage = function (text) {
            pending = parse(text);

            if (!pending) {
                actions.hidden = true;
                say('That doesn’t look like a Daily Tasks export.');

                return;
            }

            say('Found ' + pending.tasks.length + ' tasks, ' + pending.events.length + ' events and ' + Object.keys(pending.done).length + ' days of history. How should it be imported?');
            actions.hidden = false;
        };

        var finish = function (t) {
            pending = null;
            actions.hidden = true;
            area.hidden = true;
            area.value = '';
            save();
            render();
            say(t);
        };

        $('impFile').onclick = function () {
            $('fileIn').click();
        };

        $('fileIn').onchange = function (e) {
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

        $('impPaste').onclick = function () {
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

        $('doMerge').onclick = function () {
            if (!pending) return;

            mergeInto(state, pending);
            finish('Merged into your current data.');
        };

        $('doReplace').onclick = function () {
            if (!pending) return;

            state = { tasks: pending.tasks, done: pending.done, counts: pending.counts, events: pending.events };
            finish('Replaced with imported data.');
        };

        $('doCancel').onclick = function () {
            pending = null;
            actions.hidden = true;
            say('Import cancelled.');
        };

        /* File chooser (File System Access API), where the browser has it */
        var saveAsBtn = $('saveAs'), openBtn = $('openPick');
        var jsonTypes = [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }];

        var pickerError = function (e) {
            if (e && e.name === 'AbortError') {
                say('Cancelled.');
            } else {
                say('The file chooser isn’t available in this view. Use Export JSON or Import JSON… instead.');
            }
        };

        saveAsBtn.hidden = typeof window.showSaveFilePicker !== 'function';
        openBtn.hidden = typeof window.showOpenFilePicker !== 'function';

        saveAsBtn.onclick = async function () {
            try {
                var h = await window.showSaveFilePicker({ suggestedName: 'daily-tasks-' + todayKey + '.json', types: jsonTypes });
                var w = await h.createWritable();

                await w.write(exportJson());
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
    }

    render();
})();
