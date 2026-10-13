import { useEffect, useRef, useState } from 'react';
import { api, streamUrl } from './api.js';

export function useLive(siteId, lang) {
  const [site, setSite] = useState(null);
  const [people, setPeople] = useState([]);
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    if (!siteId) return undefined;
    let stop = false;
    api.snapshot(siteId, lang)
      .then((d) => {
        if (stop) return;
        setSite(d.site);
        setPeople(d.people || []);
        setEntries(d.entries || []);
      })
      .catch(() => {});

    const es = new EventSource(streamUrl(siteId, lang));
    esRef.current = es;
    es.addEventListener('hello', () => setLive(true));
    es.addEventListener('snapshot', (ev) => {
      const d = JSON.parse(ev.data);
      setSite(d.site);
      setPeople(d.people || []);
      setEntries(d.entries || []);
      setLive(true);
    });
    es.addEventListener('entries', (ev) => {
      setEntries(JSON.parse(ev.data) || []);
    });
    es.addEventListener('people', (ev) => {
      setPeople(JSON.parse(ev.data) || []);
    });
    es.onerror = () => setLive(false);
    return () => {
      stop = true;
      es.close();
    };
  }, [siteId, lang]);

  return { site, people, entries, live, setEntries, setPeople };
}

export function statusOf(entry) {
  return entry?.status || '';
}

export function isOverdue(entry) {
  if (!entry || entry.kind !== 'outpass' || entry.status !== 'out') return false;
  if (!entry.dueAt) return false;
  return new Date(entry.dueAt).getTime() < Date.now();
}

export function waitingList(entries) {
  return entries.filter((e) => e.status === 'waiting_admit' || e.status === 'waiting_approval');
}

export function approvedList(entries) {
  return entries.filter((e) => e.status === 'approved_out');
}

export function insideList(entries) {
  return entries.filter((e) => e.status === 'inside');
}

export function fmtTime(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(11, 16);
  }
}
