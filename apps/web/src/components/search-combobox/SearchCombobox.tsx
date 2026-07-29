import type { ComponentPropsWithRef, ReactNode, Ref } from 'react'
import { Check, ChevronRight, LoaderCircle, Search } from 'lucide-react'
import { ControlButton, TextInput } from '../ui'
import './SearchCombobox.css'

export function SearchCombobox<T>({
  inputProps,
  selected = false,
  open,
  loading = false,
  submitting = false,
  loadingLabel = 'Ищем…',
  suggestions,
  activeIndex = -1,
  emptyMessage,
  submitLabel = 'Проверить ответ',
  submitDisabled = false,
  onSubmit,
  onSuggestionSelect,
  onSuggestionHover,
  getSuggestionKey,
  renderSuggestion,
  containerRef,
  className = '',
}: {
  inputProps: ComponentPropsWithRef<'input'>
  selected?: boolean
  open: boolean
  loading?: boolean
  submitting?: boolean
  loadingLabel?: ReactNode
  suggestions: readonly T[]
  activeIndex?: number
  emptyMessage: ReactNode
  submitLabel?: string
  submitDisabled?: boolean
  onSubmit: () => void
  onSuggestionSelect: (item: T, index: number) => void
  onSuggestionHover?: (item: T, index: number) => void
  getSuggestionKey: (item: T) => string
  renderSuggestion: (item: T, index: number) => ReactNode
  containerRef?: Ref<HTMLDivElement>
  className?: string
}) {
  return <div ref={containerRef} className={`search-picker ui-search-combobox${submitting ? ' is-submitting' : ''} ${className}`.trim()} aria-busy={submitting}>
    <div className={`search-box ${selected ? 'selected' : ''}`}>
      <Search aria-hidden="true" />
      <TextInput {...inputProps} />
      {selected && <Check className="selected-check" aria-hidden="true" />}
      <ControlButton onClick={onSubmit} aria-label={submitting ? 'Проверяем ответ' : submitLabel} disabled={submitDisabled}>
        {submitting ? <LoaderCircle className="search-submit-spinner" aria-hidden="true" /> : <ChevronRight />}
      </ControlButton>
    </div>
    {open && <div className="suggestions" role="listbox" aria-label="Результаты поиска">
      {loading
        ? <div className="search-loading" role="status">{loadingLabel}</div>
        : suggestions.length
          ? suggestions.map((item, index) => <ControlButton
              key={getSuggestionKey(item)}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onMouseEnter={() => onSuggestionHover?.(item, index)}
              onClick={() => onSuggestionSelect(item, index)}
              disabled={inputProps.disabled}
            >{renderSuggestion(item, index)}</ControlButton>)
          : <div className="empty-search">{emptyMessage}</div>}
    </div>}
  </div>
}
