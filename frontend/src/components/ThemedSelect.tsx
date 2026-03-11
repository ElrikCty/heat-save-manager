import {type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';
import './ThemedSelect.css';

export type ThemedSelectOption = {
    value: string;
    label: string;
    tag?: string;
    disabled?: boolean;
};

type ThemedSelectProps = {
    id?: string;
    value: string;
    options: ThemedSelectOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    variant?: 'card' | 'pill';
    ariaLabel?: string;
};

const PANEL_GAP = 8;
const PANEL_MARGIN = 12;
const PANEL_MAX_HEIGHT = 320;
const TYPEAHEAD_RESET_MS = 700;

function isPrintableKey(event: ReactKeyboardEvent<HTMLElement>) {
    return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export default function ThemedSelect({
    id,
    value,
    options,
    onChange,
    placeholder = '',
    disabled = false,
    autoFocus = false,
    variant = 'card',
    ariaLabel,
}: ThemedSelectProps) {
    const generatedId = useId();
    const triggerId = id || `themed-select-${generatedId}`;
    const listboxId = `${triggerId}-listbox`;

    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const typeaheadBufferRef = useRef('');
    const typeaheadTimeoutRef = useRef<number | null>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

    const selectedIndex = useMemo(() => options.findIndex((option) => option.value === value), [options, value]);
    const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
    const enabledIndexes = useMemo(
        () => options.reduce<number[]>((indexes, option, index) => {
            if (!option.disabled) {
                indexes.push(index);
            }
            return indexes;
        }, []),
        [options],
    );
    const hasEnabledOptions = enabledIndexes.length > 0;

    function clearTypeaheadBuffer() {
        typeaheadBufferRef.current = '';
        if (typeaheadTimeoutRef.current !== null) {
            window.clearTimeout(typeaheadTimeoutRef.current);
            typeaheadTimeoutRef.current = null;
        }
    }

    function scheduleTypeaheadReset() {
        if (typeaheadTimeoutRef.current !== null) {
            window.clearTimeout(typeaheadTimeoutRef.current);
        }

        typeaheadTimeoutRef.current = window.setTimeout(() => {
            typeaheadBufferRef.current = '';
            typeaheadTimeoutRef.current = null;
        }, TYPEAHEAD_RESET_MS);
    }

    function getFallbackIndex(preferredIndex: number, direction: 1 | -1 = 1) {
        if (!hasEnabledOptions) {
            return -1;
        }

        if (preferredIndex >= 0 && !options[preferredIndex]?.disabled) {
            return preferredIndex;
        }

        return direction === -1 ? enabledIndexes[enabledIndexes.length - 1] : enabledIndexes[0];
    }

    function getNextEnabledIndex(direction: 1 | -1) {
        if (!hasEnabledOptions) {
            return -1;
        }

        const current = enabledIndexes.indexOf(highlightedIndex);
        if (current === -1) {
            return direction === -1 ? enabledIndexes[enabledIndexes.length - 1] : enabledIndexes[0];
        }

        const next = (current + direction + enabledIndexes.length) % enabledIndexes.length;
        return enabledIndexes[next];
    }

    function updatePanelPosition() {
        const trigger = triggerRef.current;
        if (!trigger) {
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const belowSpace = viewportHeight - rect.bottom - PANEL_MARGIN - PANEL_GAP;
        const aboveSpace = rect.top - PANEL_MARGIN - PANEL_GAP;
        const openAbove = belowSpace < 200 && aboveSpace > belowSpace;
        const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, openAbove ? aboveSpace : belowSpace));
        const width = Math.min(Math.max(rect.width, 180), viewportWidth - PANEL_MARGIN * 2);
        const left = Math.min(Math.max(PANEL_MARGIN, rect.left), viewportWidth - PANEL_MARGIN - width);
        const top = openAbove
            ? Math.max(PANEL_MARGIN, rect.top - PANEL_GAP - maxHeight)
            : Math.min(rect.bottom + PANEL_GAP, viewportHeight - PANEL_MARGIN - maxHeight);

        setPanelStyle({
            left,
            top,
            width,
            maxHeight,
        });
    }

    function closeMenu(restoreFocus: boolean) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        clearTypeaheadBuffer();

        if (restoreFocus) {
            window.requestAnimationFrame(() => {
                triggerRef.current?.focus();
            });
        }
    }

    function openMenu(preferredIndex: number, direction: 1 | -1 = 1) {
        if (disabled || !hasEnabledOptions) {
            return;
        }

        setHighlightedIndex(getFallbackIndex(preferredIndex, direction));
        setIsOpen(true);
    }

    function commitValue(nextValue: string) {
        if (nextValue !== value) {
            onChange(nextValue);
        }

        setIsOpen(false);
        setHighlightedIndex(-1);
        clearTypeaheadBuffer();
    }

    function runTypeahead(key: string) {
        if (!hasEnabledOptions) {
            return;
        }

        typeaheadBufferRef.current += key.toLowerCase();
        scheduleTypeaheadReset();

        const pivot = highlightedIndex >= 0 ? highlightedIndex : selectedIndex;
        const orderedIndexes = [
            ...enabledIndexes.filter((index) => index > pivot),
            ...enabledIndexes.filter((index) => index <= pivot),
        ];
        const match = orderedIndexes.find((index) => options[index].label.toLowerCase().startsWith(typeaheadBufferRef.current));
        if (match === undefined) {
            return;
        }

        if (!isOpen) {
            openMenu(match);
            return;
        }

        setHighlightedIndex(match);
    }

    function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
        if (disabled) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!isOpen) {
                openMenu(selectedIndex, 1);
                return;
            }

            setHighlightedIndex(getNextEnabledIndex(1));
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) {
                openMenu(selectedIndex, -1);
                return;
            }

            setHighlightedIndex(getNextEnabledIndex(-1));
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            if (!isOpen) {
                openMenu(enabledIndexes[0]);
                return;
            }

            setHighlightedIndex(enabledIndexes[0] ?? -1);
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            if (!isOpen) {
                openMenu(enabledIndexes[enabledIndexes.length - 1], -1);
                return;
            }

            setHighlightedIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1);
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!isOpen) {
                openMenu(selectedIndex, 1);
                return;
            }

            const highlighted = options[highlightedIndex];
            if (highlighted && !highlighted.disabled) {
                commitValue(highlighted.value);
            }
            return;
        }

        if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu(true);
            return;
        }

        if (event.key === 'Tab' && isOpen) {
            closeMenu(false);
            return;
        }

        if (isPrintableKey(event)) {
            event.preventDefault();
            runTypeahead(event.key);
        }
    }

    function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedIndex(getNextEnabledIndex(1));
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex(getNextEnabledIndex(-1));
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            setHighlightedIndex(enabledIndexes[0] ?? -1);
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            setHighlightedIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1);
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const highlighted = options[highlightedIndex];
            if (highlighted && !highlighted.disabled) {
                commitValue(highlighted.value);
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeMenu(true);
            return;
        }

        if (event.key === 'Tab') {
            closeMenu(false);
            return;
        }

        if (isPrintableKey(event)) {
            event.preventDefault();
            runTypeahead(event.key);
        }
    }

    useEffect(() => {
        if (!autoFocus || disabled) {
            return;
        }

        triggerRef.current?.focus();
    }, [autoFocus, disabled]);

    useEffect(() => {
        return () => clearTypeaheadBuffer();
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        updatePanelPosition();

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }

            if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }

            closeMenu(false);
        };

        const handleViewportUpdate = () => updatePanelPosition();

        document.addEventListener('mousedown', handlePointerDown, true);
        window.addEventListener('resize', handleViewportUpdate);
        window.addEventListener('scroll', handleViewportUpdate, true);

        const frame = window.requestAnimationFrame(() => {
            panelRef.current?.focus();
        });

        return () => {
            document.removeEventListener('mousedown', handlePointerDown, true);
            window.removeEventListener('resize', handleViewportUpdate);
            window.removeEventListener('scroll', handleViewportUpdate, true);
            window.cancelAnimationFrame(frame);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || highlightedIndex < 0) {
            return;
        }

        const activeOption = panelRef.current?.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex}"]`);
        activeOption?.scrollIntoView({block: 'nearest'});
    }, [highlightedIndex, isOpen]);

    useEffect(() => {
        if (!isOpen && highlightedIndex !== -1) {
            setHighlightedIndex(-1);
        }
    }, [highlightedIndex, isOpen]);

    const rootClassName = [
        'themed-select',
        `themed-select--${variant}`,
        isOpen ? 'is-open' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={rootClassName}>
            <button
                ref={triggerRef}
                id={triggerId}
                type="button"
                className="themed-select-trigger"
                disabled={disabled || !hasEnabledOptions}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={isOpen ? listboxId : undefined}
                aria-label={ariaLabel}
                onClick={() => {
                    if (isOpen) {
                        closeMenu(false);
                        return;
                    }

                    openMenu(selectedIndex, 1);
                }}
                onKeyDown={handleTriggerKeyDown}
            >
                <span className="themed-select-trigger-content">
                    <span className={`themed-select-trigger-label${selectedOption ? '' : ' is-placeholder'}`}>
                        {selectedOption?.label || placeholder}
                    </span>
                    {selectedOption?.tag && <span className="themed-select-tag">{selectedOption.tag}</span>}
                </span>
                <ChevronDown className="themed-select-trigger-icon" size={16} strokeWidth={2} />
            </button>

            {isOpen && typeof document !== 'undefined' ? createPortal(
                <div
                    ref={panelRef}
                    id={listboxId}
                    role="listbox"
                    tabIndex={-1}
                    aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
                    className={`themed-select-panel themed-select-panel--${variant}`}
                    style={panelStyle}
                    onKeyDown={handlePanelKeyDown}
                >
                    {options.map((option, index) => {
                        const isSelected = option.value === value;
                        const isHighlighted = index === highlightedIndex;

                        return (
                            <button
                                key={option.value}
                                id={`${listboxId}-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={option.disabled}
                                data-option-index={index}
                                className={[
                                    'themed-select-option',
                                    isSelected ? 'is-selected' : '',
                                    isHighlighted ? 'is-highlighted' : '',
                                ].filter(Boolean).join(' ')}
                                onMouseEnter={() => {
                                    if (!option.disabled) {
                                        setHighlightedIndex(index);
                                    }
                                }}
                                onClick={() => {
                                    if (!option.disabled) {
                                        commitValue(option.value);
                                    }
                                }}
                            >
                                <span className="themed-select-option-content">
                                    <span className="themed-select-option-label">{option.label}</span>
                                    {option.tag && <span className="themed-select-tag">{option.tag}</span>}
                                </span>
                                {isSelected && <Check className="themed-select-option-check" size={15} strokeWidth={2.1} />}
                            </button>
                        );
                    })}
                </div>,
                document.body,
            ) : null}
        </div>
    );
}
