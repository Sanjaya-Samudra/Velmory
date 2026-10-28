import { useEffect, useRef, useState, useId } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: (SelectOption | { value: string; label: string })[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled = false,
  className = '',
  hideLabel = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [openAbove, setOpenAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  const selectedIndex = options.findIndex(o => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  // Smart placement (flip to open above if close to viewport bottom)
  useEffect(() => {
    if (open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // If less than 240px below and more space above, open upwards
      setOpenAbove(spaceBelow < 240 && spaceAbove > spaceBelow);
    }
  }, [open]);

  // Focus active item when menu opens or focused index changes
  useEffect(() => {
    if (open) {
      const target = items.current[focus];
      if (target) {
        target.focus();
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [open, focus]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    trigger.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setFocus(Math.max(0, selectedIndex));
      setOpen(true);
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Home') {
        setFocus(0);
      } else if (e.key === 'End') {
        setFocus(options.length - 1);
      } else {
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setFocus((focus + delta + options.length) % options.length);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead jump to first match
      const char = e.key.toLowerCase();
      const matchIndex = options.findIndex((o, i) =>
        i > focus && o.label.toLowerCase().startsWith(char)
      );
      if (matchIndex >= 0) {
        setFocus(matchIndex);
      } else {
        const wrapIndex = options.findIndex(o => o.label.toLowerCase().startsWith(char));
        if (wrapIndex >= 0) setFocus(wrapIndex);
      }
    }
  };

  return (
    <div
      className={`vel-select ${className} ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${openAbove ? 'opens-above' : ''}`}
      ref={root}
    >
      {!hideLabel && (
        <label id={`${id}-label`} className="control-label" onClick={() => !disabled && trigger.current?.focus()}>
          {label}
        </label>
      )}
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        className="select-trigger"
        aria-labelledby={hideLabel ? undefined : `${id}-label`}
        aria-label={hideLabel ? label : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setFocus(Math.max(0, selectedIndex));
          setOpen(!open);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`select-value ${!selectedOption && placeholder ? 'is-placeholder' : ''}`}>
          {selectedOption ? selectedOption.label : (placeholder || label)}
        </span>
        <ChevronDown size={15} className={`select-chevron ${open ? 'is-rotated' : ''}`} />
      </button>

      {open && (
        <div
          ref={optionsRef}
          className={`select-options ${openAbove ? 'placement-above' : 'placement-below'}`}
          role="listbox"
          aria-label={label}
          onKeyDown={handleListKeyDown}
        >
          {options.length === 0 ? (
            <div className="select-empty-note">No options available</div>
          ) : (
            options.map((o, i) => {
              const isSelected = value === o.value;
              const isItemDisabled = (o as SelectOption).disabled;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isItemDisabled}
                  disabled={isItemDisabled}
                  tabIndex={focus === i ? 0 : -1}
                  ref={el => { items.current[i] = el; }}
                  key={o.value}
                  className={`select-option-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => !isItemDisabled && choose(o.value)}
                  onMouseEnter={() => setFocus(i)}
                >
                  <span className="option-label">{o.label}</span>
                  {(o as SelectOption).description && (
                    <small className="option-desc">{(o as SelectOption).description}</small>
                  )}
                  {isSelected && <Check size={14} className="option-check" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
