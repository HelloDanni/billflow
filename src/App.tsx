import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MutableRefObject, ReactNode, SyntheticEvent } from 'react';
import './App.css';

type Bill = {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  recurrence: number; // months between occurrences
  startMonth: string; // YYYY-MM
  notes?: string;
  endMonth?: string;
};

type IncomeRecurrence = 'none' | 'biweekly' | 'monthly';

type IncomeEntry = {
  id: string;
  source: string;
  amount: number;
  date: string; // ISO yyyy-mm-dd
  recurrence?: IncomeRecurrence;
};

type PaymentState = Record<string, Record<string, boolean>>; // monthKey -> billId -> paid
type CollapsibleSectionConfig = Record<string, boolean>;
type BillInstanceOverride = Pick<Bill, 'name' | 'amount' | 'dueDay' | 'notes'>;
type BillOverrides = Record<string, Record<string, BillInstanceOverride>>;
type EditingBillContext = { billId: string; monthKey: string };

type CollapsibleSectionProps = {
  id: string;
  title: string;
  children: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  containerClassName?: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  sectionRef?: MutableRefObject<HTMLElement | null> | ((node: HTMLElement | null) => void) | null;
};

const formatISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function buildISOForCurrentMonth(day: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), day);
  return formatISODate(date);
}

const DEFAULT_INCOME: IncomeEntry[] = [
  { id: 'payday-1', source: 'Paycheck', amount: 2100, date: buildISOForCurrentMonth(1), recurrence: 'monthly' },
  { id: 'payday-2', source: 'Freelance', amount: 650.5, date: buildISOForCurrentMonth(18), recurrence: 'none' },
];

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

const currency = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
};

const normalizeAmount = (value: number) => Math.round(value * 100) / 100;

const getMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const getDayFromISODate = (iso: string) => {
  const parts = iso.split('-');
  if (parts.length < 3) return 1;
  const day = Number(parts[2]);
  return Number.isNaN(day) ? 1 : day;
};

const parseISODate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  if ([year, month, day].some((value) => Number.isNaN(value))) return new Date(iso);
  return new Date(year, month - 1, day);
};

const getDateFromMonthKey = (key: string) => {
  if (!isValidMonthKey(key)) return new Date();
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

const getPreviousMonthKey = (monthKey: string) => {
  if (!isValidMonthKey(monthKey)) return null;
  const date = getDateFromMonthKey(monthKey);
  date.setMonth(date.getMonth() - 1);
  return getMonthKey(date);
};

const CURRENT_MONTH_KEY = getMonthKey(new Date());

const DEFAULT_BILLS: Bill[] = [
  { id: 'rent', name: 'Rent', amount: 1550, dueDay: 1, recurrence: 1, startMonth: CURRENT_MONTH_KEY },
  { id: 'power', name: 'Electric', amount: 120, dueDay: 8, recurrence: 1, startMonth: CURRENT_MONTH_KEY },
  { id: 'internet', name: 'Internet', amount: 75, dueDay: 12, recurrence: 1, startMonth: CURRENT_MONTH_KEY },
  { id: 'stream', name: 'Streaming Bundle', amount: 45, dueDay: 20, recurrence: 1, startMonth: CURRENT_MONTH_KEY },
];

const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const billRecurrenceOptions = [
  { value: 0, label: 'One-time' },
  { value: 1, label: 'Monthly' },
  { value: 3, label: 'Every 3 Months' },
  { value: 6, label: 'Every 6 Months' },
  { value: 12, label: 'Annual' },
];

const incomeRecurrenceOptions: { value: IncomeRecurrence; label: string }[] = [
  { value: 'none', label: 'One-time' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly' },
];

const incomeRecurrenceLabels = incomeRecurrenceOptions.reduce<Record<IncomeRecurrence, string>>((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {} as Record<IncomeRecurrence, string>);

type IncomeOccurrence = {
  occurrenceId: string;
  entry: IncomeEntry;
  date: string;
  amount: number;
  source: string;
};

type WeekBill = { bill: Bill; date: Date };
type WeekSummary = { label: string; due: number; remaining: number; hasCurrent: boolean; bills: WeekBill[] };

const isValidMonthKey = (key?: string | null): key is string => Boolean(key && /^\d{4}-\d{2}$/.test(key));

const monthsBetween = (startKey: string, target: Date) => {
  if (!isValidMonthKey(startKey)) return 0;
  const [startYear, startMonthRaw] = startKey.split('-').map(Number);
  const startMonth = startMonthRaw - 1;
  return (target.getFullYear() - startYear) * 12 + (target.getMonth() - startMonth);
};

const isBillDueInMonth = (bill: Bill, month: Date) => {
  const diff = monthsBetween(bill.startMonth, month);
  if (diff < 0) return false;
  if (bill.endMonth && monthsBetween(bill.endMonth, month) > 0) return false;
  if (bill.recurrence <= 0) {
    return diff === 0;
  }
  return diff % bill.recurrence === 0;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDayValue = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const expandIncomeEntry = (entry: IncomeEntry, month: Date): IncomeOccurrence[] => {
  const recurrence = entry.recurrence ?? 'none';
  const occurrences: IncomeOccurrence[] = [];
  const baseDate = parseISODate(entry.date);
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  const pushOccurrence = (date: Date) => {
    const dateKey = formatISODate(date);
    occurrences.push({
      occurrenceId: `${entry.id}-${dateKey}`,
      entry,
      date: dateKey,
      amount: entry.amount,
      source: entry.source,
    });
  };

  if (recurrence === 'none') {
    if (baseDate.getFullYear() === month.getFullYear() && baseDate.getMonth() === month.getMonth()) {
      pushOccurrence(baseDate);
    }
    return occurrences;
  }

  if (recurrence === 'monthly') {
    const diff = monthsBetween(getMonthKey(baseDate), month);
    if (diff >= 0) {
      const day = Math.min(baseDate.getDate(), monthEnd.getDate());
      pushOccurrence(new Date(month.getFullYear(), month.getMonth(), day));
    }
    return occurrences;
  }

  // biweekly
  const period = 14 * DAY_MS;
  let nextTime = baseDate.getTime();
  if (nextTime < monthStart.getTime()) {
    const diff = monthStart.getTime() - nextTime;
    const intervals = Math.floor(diff / period);
    nextTime += intervals * period;
    while (nextTime < monthStart.getTime()) {
      nextTime += period;
    }
  }
  for (let time = nextTime; time <= monthEnd.getTime(); time += period) {
    if (time < baseDate.getTime()) continue;
    pushOccurrence(new Date(time));
  }
  return occurrences;
};

const confirmDelete = (label: string) => {
  if (typeof window === 'undefined') return true;
  return window.confirm(`Delete ${label}? This cannot be undone.`);
};

const CollapsibleSection = ({
  id,
  title,
  children,
  description,
  toolbar,
  containerClassName,
  collapsed,
  onToggle,
  sectionRef,
}: CollapsibleSectionProps) => {
  const contentId = `${id}-content`;
  const sectionClass = containerClassName ?? 'rounded-2xl border border-slate-800 bg-slate-900/80 p-5';
  return (
    <section id={id} ref={sectionRef ?? undefined} className={`w-full max-w-full ${sectionClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="flex flex-1 items-center justify-between gap-3 rounded-xl border border-slate-800/60 bg-slate-950/30 px-3 py-2 text-left text-slate-100 transition hover:border-slate-600"
          aria-expanded={!collapsed}
          aria-controls={contentId}
        >
          <div>
            <p className="text-base font-semibold">{title}</p>
            {description && <div className="text-xs text-slate-400">{description}</div>}
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
            {collapsed ? 'Show' : 'Hide'}
          </span>
        </button>
        {toolbar}
      </div>
      <div id={contentId} className={`mt-4 ${collapsed ? 'hidden' : ''}`} aria-hidden={collapsed}>
        {children}
      </div>
    </section>
  );
};

function App() {
  const today = new Date();
  const todayISO = formatISODate(today);
  const [visibleMonth, setVisibleMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [bills, setBills] = usePersistentState<Bill[]>('billflow:bills', DEFAULT_BILLS);
  const [incomes, setIncomes] = usePersistentState<IncomeEntry[]>('billflow:income', DEFAULT_INCOME);
  const [payments, setPayments] = usePersistentState<PaymentState>('billflow:payments', {});
  const [billOverrides, setBillOverrides] = usePersistentState<BillOverrides>('billflow:bill-overrides', {});
  const [collapsedSections, setCollapsedSections] = usePersistentState<CollapsibleSectionConfig>('billflow:sections', {});
  const [openWeekLabel, setOpenWeekLabel] = useState<string | null>(null);
  const [editingBill, setEditingBill] = useState<EditingBillContext | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);
  const incomeSummaryRef = useRef<HTMLElement | null>(null);

  const billFormDefaults = {
    name: '',
    amount: '',
    dueDay: String(today.getDate()),
    recurrence: '1',
    notes: '',
    date: todayISO,
  };
  const [billForm, setBillForm] = useState(billFormDefaults);
  const [incomeForm, setIncomeForm] = useState({
    source: '',
    amount: '',
    date: todayISO,
    recurrence: 'none',
  });

  const monthKey = getMonthKey(visibleMonth);
  const openDatePicker = (event: SyntheticEvent<HTMLInputElement>) => {
    event.currentTarget.showPicker?.();
  };

  const setOverrideForBill = (targetMonthKey: string, billId: string, override?: BillInstanceOverride) => {
    setBillOverrides((prev) => {
      const next = { ...prev };
      const monthOverrides = { ...(next[targetMonthKey] ?? {}) };
      if (override) {
        monthOverrides[billId] = override;
        next[targetMonthKey] = monthOverrides;
        return next;
      }
      if (!monthOverrides[billId]) {
        return prev;
      }
      delete monthOverrides[billId];
      if (Object.keys(monthOverrides).length === 0) {
        delete next[targetMonthKey];
      } else {
        next[targetMonthKey] = monthOverrides;
      }
      return next;
    });
  };

  const cancelEditingBill = () => {
    setEditingBill(null);
    setBillForm(billFormDefaults);
  };

  const activePayments = payments[monthKey] ?? {};
  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const scrollToIncomeSummary = () => {
    setCollapsedSections((prev) => {
      if (!prev['income-summary']) return prev;
      return { ...prev, 'income-summary': false };
    });
    incomeSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const moveMonth = (delta: number) => {
    setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };
  const toggleWeekDetails = (label: string) => {
    setOpenWeekLabel((prev) => (prev === label ? null : label));
  };

  const normalizedBills = useMemo(() => {
    return bills.map((bill) => ({
      ...bill,
      recurrence: bill.recurrence ?? 1,
      startMonth: isValidMonthKey(bill.startMonth) ? bill.startMonth : CURRENT_MONTH_KEY,
      endMonth: isValidMonthKey(bill.endMonth) ? bill.endMonth : undefined,
    }));
  }, [bills]);

  const getBillsForMonth = useCallback(
    (month: Date) => {
      const monthKeyForMonth = getMonthKey(month);
      const overrides = billOverrides[monthKeyForMonth] ?? {};
      const dueInMonth = normalizedBills.filter((bill) => isBillDueInMonth(bill, month));
      return dueInMonth.map((bill) => (overrides[bill.id] ? { ...bill, ...overrides[bill.id] } : bill));
    },
    [billOverrides, normalizedBills]
  );

  const visibleBills = useMemo(() => getBillsForMonth(visibleMonth), [getBillsForMonth, visibleMonth]);

  const referenceDate = useMemo(() => {
    const now = new Date();
    if (now.getFullYear() === visibleMonth.getFullYear() && now.getMonth() === visibleMonth.getMonth()) {
      return now;
    }
    return new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  }, [visibleMonth]);

  const expandedIncomes = useMemo(() => {
    return incomes.flatMap((income) => expandIncomeEntry(income, visibleMonth));
  }, [incomes, visibleMonth]);

  const incomesByDay = useMemo(() => {
    const map: Record<number, IncomeOccurrence[]> = {};
    expandedIncomes.forEach((income) => {
      const day = getDayFromISODate(income.date);
      map[day] = map[day] ? [...map[day], income] : [income];
    });
    return map;
  }, [expandedIncomes]);

  const billsByDay = useMemo(() => {
    const map: Record<number, Bill[]> = {};
    const maxDay = daysInMonth(visibleMonth);
    visibleBills.forEach((bill) => {
      const day = Math.min(bill.dueDay, maxDay);
      map[day] = map[day] ? [...map[day], bill] : [bill];
    });
    return map;
  }, [visibleBills, visibleMonth]);

  const calendarCells = useMemo(() => {
    const startOfMonth = new Date(visibleMonth);
    const startOffset = startOfMonth.getDay();
    const calendarStart = new Date(visibleMonth);
    calendarStart.setDate(1 - startOffset);
    const todayKey = formatISODate(today);

    return Array.from({ length: 42 }, (_, idx) => {
      const date = new Date(calendarStart);
      date.setDate(calendarStart.getDate() + idx);
      const inCurrentMonth = date.getMonth() === visibleMonth.getMonth();
      const day = date.getDate();
      const billsForDay = inCurrentMonth ? billsByDay[day] ?? [] : [];
      const incomesForDay = inCurrentMonth ? incomesByDay[day] ?? [] : [];
      const isToday = formatISODate(date) === todayKey;
      return {
        key: date.toISOString(),
        date,
        day,
        inCurrentMonth,
        bills: billsForDay,
        incomes: incomesForDay,
        hasIncome: incomesForDay.length > 0,
        isToday,
      };
    });
  }, [visibleMonth, billsByDay, incomesByDay, today]);

  const totalDue = useMemo(() => visibleBills.reduce((sum, bill) => sum + bill.amount, 0), [visibleBills]);
  const paidSoFar = useMemo(
    () =>
      visibleBills.reduce((sum, bill) => {
        return activePayments[bill.id] ? sum + bill.amount : sum;
      }, 0),
    [visibleBills, activePayments]
  );
  const remainingDue = totalDue - paidSoFar;

  const monthlyIncome = useMemo(() => expandedIncomes.reduce((sum, income) => sum + income.amount, 0), [expandedIncomes]);

  const weeklyBreakdown = useMemo<WeekSummary[]>(() => {
    const weeks: WeekSummary[] = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      const slice = calendarCells.slice(i, i + 7);
      const weekDue = slice.reduce(
        (sum, cell) => sum + cell.bills.reduce((billSum, bill) => billSum + bill.amount, 0),
        0
      );
      const weekPaid = slice.reduce(
        (sum, cell) => sum + cell.bills.reduce((billSum, bill) => billSum + (activePayments[bill.id] ? bill.amount : 0), 0),
        0
      );
      const start = slice[0].date;
      const end = slice[slice.length - 1].date;
      const label = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(
        undefined,
        { month: 'short', day: 'numeric' }
      )}`;
      const hasCurrent = slice.some((cell) => cell.inCurrentMonth);
      const billsInWeek = slice.flatMap((cell) => cell.bills.map((bill) => ({ bill, date: cell.date })));
      weeks.push({ label, due: weekDue, remaining: weekDue - weekPaid, hasCurrent, bills: billsInWeek });
    }
    return weeks.filter((week) => week.hasCurrent);
  }, [calendarCells, activePayments]);

  const handleBillSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = billForm.name.trim();
    const amount = Number(billForm.amount);
    const dueDay = billForm.date ? getDayFromISODate(billForm.date) : Number(billForm.dueDay);
    const recurrence = Number(billForm.recurrence ?? '1');
    if (!name || amount <= 0 || dueDay < 1 || dueDay > 31 || Number.isNaN(recurrence) || recurrence < 0) return;
    const startMonthFromDate = billForm.date ? billForm.date.slice(0, 7) : monthKey;

    setBills((prev) => {
      const next: Bill = {
        id: makeId(),
        name,
        amount: normalizeAmount(amount),
        dueDay,
        recurrence,
        startMonth: startMonthFromDate,
        notes: billForm.notes.trim() || undefined,
      };
      return [...prev, next];
    });

    setBillForm(billFormDefaults);
  };

  const extractBillFormValues = () => {
    const name = billForm.name.trim();
    const amountValue = Number(billForm.amount);
    if (!name || amountValue <= 0 || !billForm.date) return null;
    const dueDay = getDayFromISODate(billForm.date);
    const notes = billForm.notes.trim();
    return {
      name,
      amount: normalizeAmount(amountValue),
      dueDay,
      notes: notes ? notes : undefined,
    };
  };

  const scrollToEditForm = () => {
    editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startEditingExistingBill = (bill: Bill, occurrenceDate: Date) => {
    setEditingBill({ billId: bill.id, monthKey: getMonthKey(occurrenceDate) });
    setBillForm({
      name: bill.name,
      amount: String(bill.amount),
      dueDay: String(bill.dueDay),
      recurrence: String(bill.recurrence),
      notes: bill.notes ?? '',
      date: formatISODate(occurrenceDate),
    });
    setCollapsedSections((prev) => ({ ...prev, 'add-bill': false }));
    scrollToEditForm();
  };

  const handleUpdateBillInstance = () => {
    if (!editingBill) return;
    const values = extractBillFormValues();
    if (!values) return;
    setOverrideForBill(editingBill.monthKey, editingBill.billId, values);
    cancelEditingBill();
  };

  const handleUpdateFutureInstances = () => {
    if (!editingBill) return;
    const values = extractBillFormValues();
    if (!values) return;
    const recurrenceValue = Number(billForm.recurrence ?? '1');
    if (Number.isNaN(recurrenceValue) || recurrenceValue < 0) return;
    const editingMonthDate = getDateFromMonthKey(editingBill.monthKey);
    let createdBillId: string | null = null;
    setBills((prev) => {
      const index = prev.findIndex((bill) => bill.id === editingBill.billId);
      if (index === -1) return prev;
      const currentBill = prev[index];
      const nextBills = [...prev];
      const updatedBase = {
        ...currentBill,
        name: values.name,
        amount: values.amount,
        dueDay: values.dueDay,
        recurrence: recurrenceValue,
        notes: values.notes,
      };
      if (currentBill.recurrence <= 0 || monthsBetween(currentBill.startMonth, editingMonthDate) === 0) {
        nextBills[index] = { ...updatedBase };
        return nextBills;
      }
      const previousMonthKey = getPreviousMonthKey(editingBill.monthKey);
      if (!previousMonthKey) {
        nextBills[index] = { ...updatedBase };
        return nextBills;
      }
      const safePreviousMonthKey: string = previousMonthKey;
      nextBills[index] = { ...currentBill, endMonth: safePreviousMonthKey };
      const futureBill: Bill = {
        ...currentBill,
        id: makeId(),
        startMonth: editingBill.monthKey,
        endMonth: currentBill.endMonth,
        recurrence: recurrenceValue,
        name: values.name,
        amount: values.amount,
        dueDay: values.dueDay,
        notes: values.notes,
      };
      createdBillId = futureBill.id;
      nextBills.push(futureBill);
      return nextBills;
    });
    const newBillId = createdBillId;
    setOverrideForBill(editingBill.monthKey, editingBill.billId);
    if (newBillId) {
      setPayments((prev) => {
        const monthPayments = prev[editingBill.monthKey];
        if (!monthPayments || !monthPayments[editingBill.billId]) return prev;
        const nextMonthPayments = { ...monthPayments };
        nextMonthPayments[newBillId] = nextMonthPayments[editingBill.billId];
        delete nextMonthPayments[editingBill.billId];
        return { ...prev, [editingBill.monthKey]: nextMonthPayments };
      });
    }
    cancelEditingBill();
  };

  const handleIncomeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = incomeForm.source.trim();
    const amount = Number(incomeForm.amount);
    const recurrence = (incomeForm.recurrence as IncomeRecurrence) ?? 'none';
    if (!source || amount <= 0 || !incomeForm.date) return;

    setIncomes((prev) => [
      ...prev,
      {
        id: makeId(),
        source,
        amount: normalizeAmount(amount),
        date: incomeForm.date,
        recurrence,
      },
    ]);

    setIncomeForm({
      source: '',
      amount: '',
      date: incomeForm.date,
      recurrence,
    });
  };

  const deleteIncome = (income: IncomeEntry) => {
    if (!confirmDelete(`income "${income.source}"`)) return;
    setIncomes((prev) => prev.filter((entry) => entry.id !== income.id));
  };

  const togglePaid = (billId: string) => {
    setPayments((prev) => {
      const monthPayments = prev[monthKey] ?? {};
      const nextMonthPayments = { ...monthPayments, [billId]: !monthPayments[billId] };
      return { ...prev, [monthKey]: nextMonthPayments };
    });
  };

  const deleteBill = (bill: Bill) => {
    if (!confirmDelete(`bill "${bill.name}"`)) return;
    const billId = bill.id;
    if (editingBill?.billId === billId) {
      cancelEditingBill();
    }
    setBills((prev) => prev.filter((entry) => entry.id !== billId));
    setPayments((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((key) => {
        if (next[key]?.[billId]) {
          next[key] = { ...next[key] };
          delete next[key][billId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setBillOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (next[key]?.[billId]) {
          next[key] = { ...next[key] };
          delete next[key][billId];
          if (Object.keys(next[key]).length === 0) {
            delete next[key];
          }
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  };

  const monthLabel = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const monthlyIncomeEntries = useMemo(
    () => [...expandedIncomes].sort((a, b) => a.date.localeCompare(b.date)),
    [expandedIncomes]
  );

  const nextIncomeSummary = useMemo(() => {
    const monthsToScan = Array.from({ length: 6 }, (_, idx) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + idx, 1));
    const referenceTime = startOfDayValue(referenceDate);
    const incomeOccurrences = monthsToScan.flatMap((month) => incomes.flatMap((income) => expandIncomeEntry(income, month)));
    const sortedIncomes = incomeOccurrences
      .map((occurrence) => ({ ...occurrence, time: startOfDayValue(parseISODate(occurrence.date)) }))
      .filter((occurrence) => occurrence.time >= referenceTime)
      .sort((a, b) => a.time - b.time);

    if (sortedIncomes.length === 0) return null;

    const billEntries = monthsToScan.flatMap((month) => {
      const billsForMonth = getBillsForMonth(month);
      const monthKeyForMonth = getMonthKey(month);
      const monthPayments = payments[monthKeyForMonth] ?? {};
      const maxDay = daysInMonth(month);
      return billsForMonth.map((bill) => {
        const dueDate = new Date(month.getFullYear(), month.getMonth(), Math.min(bill.dueDay, maxDay));
        return { bill, dueDate, paid: Boolean(monthPayments[bill.id]), time: startOfDayValue(dueDate) };
      });
    });

    const collectIncomeGroup = (startIndex: number) => {
      const groupTime = sortedIncomes[startIndex].time;
      const groupDate = parseISODate(sortedIncomes[startIndex].date);
      const incomesForGroup: (typeof sortedIncomes)[number][] = [];
      let index = startIndex;
      while (index < sortedIncomes.length && sortedIncomes[index].time === groupTime) {
        incomesForGroup.push(sortedIncomes[index]);
        index += 1;
      }
      const amount = incomesForGroup.reduce((sum, occurrence) => sum + occurrence.amount, 0);
      return {
        nextIndex: index,
        group: {
          time: groupTime,
          date: groupDate,
          incomes: incomesForGroup,
          amount,
        },
      };
    };

    const includedGroups: {
      time: number;
      date: Date;
      incomes: (typeof sortedIncomes)[number][];
      amount: number;
    }[] = [];

    const firstGroupResult = collectIncomeGroup(0);
    includedGroups.push(firstGroupResult.group);
    let nextIndex = firstGroupResult.nextIndex;
    let lastIncludedTime = firstGroupResult.group.time;

    while (nextIndex < sortedIncomes.length) {
      const candidateTime = sortedIncomes[nextIndex].time;
      const hasBlockingBill = billEntries.some((entry) => entry.time > lastIncludedTime && entry.time < candidateTime);
      if (hasBlockingBill) break;
      const nextGroupResult = collectIncomeGroup(nextIndex);
      includedGroups.push(nextGroupResult.group);
      lastIncludedTime = nextGroupResult.group.time;
      nextIndex = nextGroupResult.nextIndex;
    }

    const allIncludedIncomes = includedGroups.flatMap((group) => group.incomes);
    const combinedIncomeAmount = allIncludedIncomes.reduce((sum, income) => sum + income.amount, 0);
    const sources = Array.from(new Set(allIncludedIncomes.map((income) => income.source)));
    const coverageStart = includedGroups[0].date;
    const coverageEnd = includedGroups[includedGroups.length - 1].date;

    const dueBeforeFirstIncome = billEntries.filter((entry) => entry.time < includedGroups[0].time);
    const totalDue = dueBeforeFirstIncome.reduce((sum, entry) => sum + entry.bill.amount, 0);
    const remainingDue = dueBeforeFirstIncome.reduce((sum, entry) => (entry.paid ? sum : sum + entry.bill.amount), 0);
    const unpaidCount = dueBeforeFirstIncome.filter((entry) => !entry.paid).length;

    return {
      groups: includedGroups,
      incomeCount: allIncludedIncomes.length,
      combinedIncomeAmount,
      sources,
      coverageStart,
      coverageEnd,
      totalDue,
      remainingDue,
      billCount: dueBeforeFirstIncome.length,
      unpaidCount,
      primaryIncome: includedGroups[0].incomes[0],
    };
  }, [getBillsForMonth, incomes, payments, referenceDate, visibleMonth]);

  const isEditingExpense = Boolean(editingBill);
  const editingMonthLabel = editingBill
    ? getDateFromMonthKey(editingBill.monthKey).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : '';
  const editingInstanceLabel =
    isEditingExpense && billForm.date
      ? parseISODate(billForm.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
      : '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-3 py-8 sm:px-5 lg:px-8">
        <CollapsibleSection
          id="overview"
          title="Budget Overview"
          containerClassName="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-800 p-6 shadow-xl shadow-slate-950/40"
          collapsed={Boolean(collapsedSections['overview'])}
          onToggle={toggleSection}
          toolbar={
            <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/30 px-3 py-1 text-lg font-semibold text-slate-100">
              <button
                onClick={() => moveMonth(-1)}
                className="rounded-full border border-slate-700 p-2 text-sm hover:border-slate-500"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="min-w-[150px] text-center">{monthLabel}</span>
              <button
                onClick={() => moveMonth(1)}
                className="rounded-full border border-slate-700 p-2 text-sm hover:border-slate-500"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          }
        >
          <dl className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Monthly Bills</dt>
              <dd className="text-2xl font-semibold text-rose-300">{currency(totalDue)}</dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Remaining Due</dt>
              <dd className="text-2xl font-semibold text-amber-300">{currency(remainingDue)}</dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-slate-400">Income This Month</dt>
              <dd>
                <button
                  type="button"
                  onClick={scrollToIncomeSummary}
                  aria-label="Jump to logged incomes list"
                  className="mx-auto block text-2xl font-semibold text-emerald-300 transition hover:text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  {currency(monthlyIncome)}
                </button>
              </dd>
            </div>
          </dl>
        </CollapsibleSection>

        <main className="grid w-full gap-6 lg:grid-cols-3">
          <CollapsibleSection
            id="calendar"
            title="Bill Calendar"
            description="Visualize all due dates for the month."
            containerClassName="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6 lg:col-span-2"
            collapsed={Boolean(collapsedSections['calendar'])}
            onToggle={toggleSection}
          >
            <div className="mt-2 space-y-2">
              <div className="grid w-full grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:gap-2 sm:text-xs">
                {dayName.map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>
              <div className="grid w-full grid-cols-7 gap-1 sm:gap-2 lg:gap-3">
                {calendarCells.map((cell) => {
                  const cellClasses = [
                    'relative min-h-[88px] overflow-hidden rounded-xl border p-1 text-[11px] sm:min-h-[120px] sm:p-3 sm:text-sm',
                    cell.inCurrentMonth ? 'border-slate-800 bg-slate-900' : 'border-transparent bg-transparent text-slate-600',
                  ];
                  if (cell.isToday && cell.inCurrentMonth) {
                    cellClasses.push('ring-2 ring-emerald-400/60');
                  }
                  return (
                    <div key={cell.key} className={cellClasses.join(' ')}>
                      <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold sm:text-xs">
                        <span className={cell.inCurrentMonth ? 'text-slate-200' : 'text-slate-600'}>{cell.day}</span>
                        {cell.bills.length > 0 && (
                          <span className="ml-auto truncate text-[11px] text-slate-400">
                            {currency(cell.bills.reduce((sum, bill) => sum + bill.amount, 0))}
                          </span>
                        )}
                      </div>
                      {cell.hasIncome && (
                        <span
                          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-400"
                          aria-label="Income scheduled"
                        />
                      )}
                      <div className="mt-2 space-y-2">
                        {cell.bills.map((bill) => {
                          const paid = Boolean(activePayments[bill.id]);
                          return (
                            <div key={bill.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[11px] sm:text-xs">
                              <div className="flex min-w-0 items-center justify-between gap-2 font-medium">
                                <span className="sr-only sm:hidden">{bill.name}</span>
                                <span
                                  className={`${
                                    paid ? 'text-slate-500 line-through' : 'text-slate-100'
                                  } hidden min-w-0 truncate sm:inline`}
                                >
                                  {bill.name}
                                </span>
                                <span className={`${paid ? 'text-emerald-400' : 'text-slate-100'} shrink-0`}>
                                  {currency(bill.amount)}
                                </span>
                              </div>
                              {bill.notes && <p className="text-[10px] text-slate-400">{bill.notes}</p>}
                              <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
                                <button
                                  onClick={() => togglePaid(bill.id)}
                                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                                    paid ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'
                                  }`}
                                >
                                  {paid ? 'Paid' : 'Mark Paid'}
                                </button>
                                <button
                                  onClick={() => deleteBill(bill)}
                                  className="text-slate-500 transition hover:text-rose-400"
                                  aria-label={`Delete ${bill.name}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {cell.inCurrentMonth && cell.bills.length === 0 && (
                          <p className="text-[11px] text-slate-500">No bills</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CollapsibleSection>

          <aside className="flex w-full flex-col gap-5 lg:col-span-1">
            <CollapsibleSection
              id="next-income"
              title="Due This Pay Period"
              description="Bills scheduled before your next paycheck."
              collapsed={Boolean(collapsedSections['next-income'])}
              onToggle={toggleSection}
            >
              {nextIncomeSummary ? (
                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Upcoming income</p>
                      <p className="text-base font-semibold text-slate-100">
                        {nextIncomeSummary.primaryIncome.source}
                      </p>
                      {nextIncomeSummary.incomeCount > 1 && (
                        <p className="text-xs text-slate-400">
                          {nextIncomeSummary.incomeCount} incomes scheduled
                        </p>
                      )}
                      <p className="text-xs text-slate-400">
                        {nextIncomeSummary.coverageStart.getTime() === nextIncomeSummary.coverageEnd.getTime()
                          ? nextIncomeSummary.coverageStart.toLocaleDateString()
                          : `${nextIncomeSummary.coverageStart.toLocaleDateString()} – ${nextIncomeSummary.coverageEnd.toLocaleDateString()}`}
                      </p>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        {nextIncomeSummary.incomeCount === 1
                          ? incomeRecurrenceLabels[nextIncomeSummary.primaryIncome.entry.recurrence ?? 'none']
                          : nextIncomeSummary.groups.length === 1
                            ? 'Multiple entries same day'
                            : `${nextIncomeSummary.groups.length} income dates`}
                      </p>
                      {nextIncomeSummary.sources.length > 0 && (
                        <p className="text-[11px] text-slate-500">
                          {nextIncomeSummary.sources.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-300">
                        {currency(nextIncomeSummary.combinedIncomeAmount)}
                      </p>
                      <p className="text-[11px] text-slate-500">Scheduled</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">Expenses before then</p>
                        <p className="text-[11px] text-slate-400">
                          {nextIncomeSummary.billCount} {nextIncomeSummary.billCount === 1 ? 'bill' : 'bills'} scheduled
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold text-amber-200">{currency(nextIncomeSummary.totalDue)}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Total due</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                      <span>Unpaid: {nextIncomeSummary.unpaidCount}</span>
                      <span className={nextIncomeSummary.remainingDue === 0 ? 'text-emerald-300' : 'text-amber-200'}>
                        Remaining {currency(nextIncomeSummary.remainingDue)}
                      </span>
                    </div>
                  </div>
                  {nextIncomeSummary.groups.length > 1 && (
                    <ul className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/40 p-2 text-[11px] text-slate-400">
                      {nextIncomeSummary.groups.map((group) => (
                        <li key={`next-income-${group.date.toISOString()}`} className="flex items-center justify-between">
                          <span>{group.date.toLocaleDateString()}</span>
                          <span className="text-slate-200">{currency(group.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Log an upcoming income to see which bills come before it.</p>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="weekly"
              title="Weekly Totals"
              description="Track what's due each week and how much remains unpaid."
              collapsed={Boolean(collapsedSections['weekly'])}
              onToggle={toggleSection}
            >
              <ul className="space-y-3">
                {weeklyBreakdown.map((week) => {
                  const isOpen = openWeekLabel === week.label;
                  return (
                    <li
                      key={week.label}
                      className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => toggleWeekDetails(week.label)}
                        className="w-full text-left"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center justify-between font-semibold text-slate-100">
                          <span>{week.label}</span>
                          <span>{currency(week.due)}</span>
                        </div>
                        <p className="text-xs text-slate-400">
                          Remaining:&nbsp;
                          <span className={week.remaining === 0 ? 'text-emerald-300' : 'text-amber-300'}>
                            {currency(week.remaining)}
                          </span>
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                          {isOpen ? 'Hide bills' : 'Show bills'}
                        </p>
                      </button>
                      {isOpen && (
                        <div className="mt-3 space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/30 p-3 text-xs sm:text-sm">
                          {week.bills.length > 0 ? (
                            week.bills.map(({ bill, date }) => {
                              const paid = Boolean(activePayments[bill.id]);
                              return (
                                <div key={`${week.label}-${bill.id}-${date.toISOString()}`} className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => togglePaid(bill.id)}
                                    aria-pressed={paid}
                                    className={`flex w-full flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${
                                      paid
                                        ? 'border-emerald-700/50 bg-emerald-500/10 text-emerald-200'
                                        : 'border-slate-800 bg-slate-950/50 text-slate-200 hover:border-slate-600'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <p className={`truncate font-semibold ${paid ? 'line-through opacity-80' : 'text-slate-100'}`}>
                                        {bill.name}
                                      </p>
                                      <p className="text-[11px] text-slate-400">{date.toLocaleDateString()}</p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end">
                                      <span className="font-semibold">{currency(bill.amount)}</span>
                                      <span className={`text-[11px] uppercase tracking-wide ${paid ? 'text-emerald-300' : 'text-amber-300'}`}>
                                        {paid ? 'Paid' : 'Tap to mark paid'}
                                      </span>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditingExistingBill(bill, date)}
                                    className="shrink-0 rounded-lg border border-slate-700/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
                                    aria-label={`Edit ${bill.name} for ${date.toLocaleDateString()}`}
                                  >
                                    Edit
                                  </button>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-xs text-slate-500">No bills scheduled this week.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {weeklyBreakdown.length === 0 && <li className="text-sm text-slate-500">No bills scheduled this month.</li>}
              </ul>
            </CollapsibleSection>

            <CollapsibleSection
              id="income-summary"
              title="Income This Month"
              description={`Total logged: ${currency(monthlyIncome)}`}
              collapsed={Boolean(collapsedSections['income-summary'])}
              onToggle={toggleSection}
              sectionRef={incomeSummaryRef}
            >
              <div className="space-y-3">
                {monthlyIncomeEntries.length > 0 ? (
                  monthlyIncomeEntries.map((income) => {
                    const recurrence = income.entry.recurrence ?? 'none';
                    return (
                      <div
                        key={income.occurrenceId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-slate-100">{income.source}</p>
                          <p className="text-xs text-slate-400">{parseISODate(income.date).toLocaleDateString()}</p>
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            {incomeRecurrenceLabels[recurrence]}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-emerald-300">{currency(income.amount)}</p>
                          <button
                            onClick={() => deleteIncome(income.entry)}
                            className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-rose-500 hover:text-rose-300"
                            aria-label={`Delete income ${income.source}`}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">No income recorded for this month yet.</p>
                )}
              </div>
            </CollapsibleSection>
          </aside>
        </main>

        <div className="mt-6 flex w-full flex-col gap-6">
          <div ref={editFormRef}>
            <CollapsibleSection
              id="add-bill"
              title="Add Expense"
              description="Keep expenses organized."
              collapsed={Boolean(collapsedSections['add-bill'])}
              onToggle={toggleSection}
            >
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                if (isEditingExpense) {
                  event.preventDefault();
                  return;
                }
                handleBillSubmit(event);
              }}
            >
              {isEditingExpense && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Editing expense for {editingInstanceLabel || editingMonthLabel}. Choose how you want to apply the changes below.
                </div>
              )}
              <label className="text-sm">
                <span className="text-slate-300">Name</span>
                <input
                  type="text"
                  value={billForm.name}
                  onChange={(e) => setBillForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-300">Amount</span>
                <input
                  type="number"
                  min="1"
                  value={billForm.amount}
                  onChange={(e) => setBillForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
              </label>
                <label className="text-sm">
                  <span className="text-slate-300">Date</span>
                <input
                  type="date"
                  value={billForm.date}
                  onChange={(e) => {
                    const value = e.target.value;
                    setBillForm((prev) => ({
                      ...prev,
                      date: value,
                      dueDay: value ? String(getDayFromISODate(value)) : prev.dueDay,
                    }));
                  }}
                  onClick={openDatePicker}
                  onFocus={openDatePicker}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
                </label>
              <label className="text-sm">
                <span className="text-slate-300">Recurrence</span>
                <select
                  value={billForm.recurrence}
                  onChange={(e) => setBillForm((prev) => ({ ...prev, recurrence: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                >
                  {billRecurrenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-slate-300">Notes (optional)</span>
                <input
                  type="text"
                  value={billForm.notes}
                  onChange={(e) => setBillForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                />
              </label>
              {isEditingExpense ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleUpdateBillInstance}
                    className="flex-1 rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-400"
                  >
                    Update This Instance
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdateFutureInstances}
                    className="flex-1 rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Update Future Instances
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditingBill}
                    className="flex-1 rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  className="mt-2 rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Save Expense
                </button>
              )}
            </form>
            </CollapsibleSection>
          </div>

          <CollapsibleSection
            id="log-income"
            title="Log Income"
            description="Capture every paycheck or deposit."
            collapsed={Boolean(collapsedSections['log-income'])}
            onToggle={toggleSection}
          >
            <form className="flex flex-col gap-3" onSubmit={handleIncomeSubmit}>
              <label className="text-sm">
                <span className="text-slate-300">Source</span>
                <input
                  type="text"
                  value={incomeForm.source}
                  onChange={(e) => setIncomeForm((prev) => ({ ...prev, source: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-300">Amount</span>
                <input
                  type="number"
                  min="1"
                  value={incomeForm.amount}
                  onChange={(e) => setIncomeForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-300">Date</span>
                <input
                  type="date"
                  value={incomeForm.date}
                  onChange={(e) => setIncomeForm((prev) => ({ ...prev, date: e.target.value }))}
                  onClick={openDatePicker}
                  onFocus={openDatePicker}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-slate-300">Recurrence</span>
                <select
                  value={incomeForm.recurrence}
                  onChange={(e) => setIncomeForm((prev) => ({ ...prev, recurrence: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
                >
                  {incomeRecurrenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="mt-2 rounded-xl bg-sky-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
              >
                Add Income
              </button>
            </form>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

export default App;
