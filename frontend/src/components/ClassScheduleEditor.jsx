import { useEffect, useState } from "react";

import { getMyClassSchedule, saveMyClassSchedule } from "../services/api";

const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function currentAcademicPeriod() {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const year = Number(values.year), month = Number(values.month);
    return month >= 7 ? `${year}-1` : `${year - 1}-2`;
}

function followingPeriod(period) {
    const [year, semester] = period.split("-").map(Number);
    return semester === 1 ? `${year}-2` : `${year + 1}-1`;
}

export default function ClassScheduleEditor() {
    const [period, setPeriod] = useState(currentAcademicPeriod);
    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        getMyClassSchedule(period)
            .then((data) => { if (active) setSlots(data.slots || []); })
            .catch((requestError) => { if (active) setError(requestError.message || "Your class schedule could not be loaded."); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [period]);

    function updateSlot(index, patch) {
        setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
        setNotice("");
    }

    async function save(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const data = await saveMyClassSchedule({ academic_period: period, slots });
            setSlots(data.slots || []);
            setNotice("Your weekly class schedule has been saved.");
        } catch (requestError) {
            setError(requestError.message || "Your class schedule could not be saved.");
        } finally {
            setSaving(false);
        }
    }

    const nextPeriod = followingPeriod(period);
    const previousPeriod = period.endsWith("-1") ? `${Number(period.slice(0, 4)) - 1}-2` : `${period.slice(0, 4)}-1`;

    return <section id="council-class-schedule" className="council-class-schedule-card" aria-labelledby="council-class-schedule-title">
        <header>
            <div><span className="eyebrow">PROFILE · AVAILABILITY</span><h2 id="council-class-schedule-title">Recurring class schedule</h2><p>Used to flag task conflicts while planning. Your schedule stays separate from participation and attendance.</p></div>
            <label>Academic term<select value={period} onChange={(event) => setPeriod(event.target.value)} disabled={saving}>
                {[previousPeriod, period, nextPeriod].map((value) => <option value={value} key={value}>{value.slice(0, 4)} · Semester {value.endsWith("-1") ? "1" : "2"}</option>)}
            </select></label>
        </header>
        {error && <p className="profile-form-message is-error" role="alert">{error}</p>}
        {notice && <p className="profile-form-message is-success" role="status">{notice}</p>}
        {loading ? <p role="status">Loading schedule…</p> : <form onSubmit={save}>
            {slots.length ? <div className="council-class-schedule-list">{slots.map((slot, index) => <div className="council-class-schedule-row" key={`${index}-${slot.day_of_week}`}>
                <label>Day<select value={slot.day_of_week} onChange={(event) => updateSlot(index, { day_of_week: Number(event.target.value) })}>{weekDays.map((day, dayIndex) => <option value={dayIndex} key={day}>{day}</option>)}</select></label>
                <label>Start<input type="time" value={slot.start_time} required onChange={(event) => updateSlot(index, { start_time: event.target.value })} /></label>
                <label>End<input type="time" value={slot.end_time} required onChange={(event) => updateSlot(index, { end_time: event.target.value })} /></label>
                <label>Course / class (optional)<input maxLength={100} value={slot.label || ""} placeholder="e.g. Biology" onChange={(event) => updateSlot(index, { label: event.target.value })} /></label>
                <button type="button" className="profile-remove-photo" onClick={() => setSlots((current) => current.filter((_, slotIndex) => slotIndex !== index))} aria-label={`Remove ${weekDays[Number(slot.day_of_week)] || "class"} class block`}>Remove</button>
            </div>)}</div> : <div className="admin-empty-state council-class-schedule-empty"><h3>No classes added for this term</h3><p>Add recurring blocks so planners can see when a task overlaps your class.</p></div>}
            <div className="council-class-schedule-actions"><button type="button" className="admin-secondary-action" onClick={() => setSlots((current) => [...current, { day_of_week: 1, start_time: "08:00", end_time: "09:00", label: "" }])} disabled={slots.length >= 40}>Add class block</button><button type="submit" className="admin-primary-action" disabled={saving || loading}>{saving ? "Saving schedule…" : "Save schedule"}</button></div>
            <small>Times use Philippine local time (Asia/Manila). Overlapping class blocks are rejected.</small>
        </form>}
    </section>;
}
