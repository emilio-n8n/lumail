import * as React from 'react'
import {
  Columns2,
  GripVertical,
  Heading1,
  Image as ImageIcon,
  Link2,
  Minus,
  MousePointerClick,
  Code2,
  Share2,
  Smartphone,
  Monitor,
  Eye,
  Plus,
  Trash2,
  Type,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, Field } from '@/components/ui/input'
import { renderDocument } from '@/lib/email/render-document'
import { EMAIL_VARIABLES } from '@/lib/email/variables'
import type { EmailBlock, EmailDocument } from '@/lib/domain/types'

/**
 * Email editor.
 *
 * A block list rather than free-form canvas — email is linear, and a block model
 * is what lets the same document render identically in the preview, in a test
 * send, and through the API. Custom HTML remains available as an explicit block
 * for people who need it.
 */

const BLOCK_MENU: {
  type: EmailBlock['type']
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}[] = [
  { type: 'heading', label: 'Heading', icon: Heading1, description: 'Section title' },
  { type: 'text', label: 'Text', icon: Type, description: 'Paragraph' },
  { type: 'image', label: 'Image', icon: ImageIcon, description: 'Image or logo' },
  { type: 'button', label: 'Button', icon: MousePointerClick, description: 'Call to action' },
  { type: 'divider', label: 'Divider', icon: Minus, description: 'Horizontal rule' },
  { type: 'spacer', label: 'Spacer', icon: Columns2, description: 'Vertical space' },
  { type: 'columns', label: 'Columns', icon: Columns2, description: 'Side by side' },
  { type: 'social', label: 'Social links', icon: Share2, description: 'Footer links' },
  { type: 'html', label: 'Custom HTML', icon: Code2, description: 'Raw markup' },
]

function newBlock(type: EmailBlock['type']): EmailBlock {
  const id = `b_${Math.random().toString(36).slice(2, 9)}`
  switch (type) {
    case 'heading':
      return { id, type, props: { level: 2, text: 'A heading', align: 'left' } }
    case 'text':
      return {
        id,
        type,
        props: {
          text: 'Write something worth opening. Keep it to a few lines.',
          align: 'left',
          size: 'md',
        },
      }
    case 'image':
      return {
        id,
        type,
        props: {
          src: 'https://placehold.co/1200x400/17181a/ffffff?text=1200%C3%97400',
          alt: 'Image',
          href: '',
          width: 'full',
        },
      }
    case 'button':
      return {
        id,
        type,
        props: {
          label: 'Read more',
          href: 'https://example.com',
          align: 'left',
          variant: 'primary',
        },
      }
    case 'divider':
      return { id, type, props: {} }
    case 'spacer':
      return { id, type, props: { height: 24 } }
    case 'columns':
      return {
        id,
        type,
        props: {
          columns: [
            {
              id: `${id}_l`,
              blocks: [
                {
                  id: `${id}_l_t`,
                  type: 'text',
                  props: { text: 'Left column', align: 'left', size: 'sm' },
                },
              ],
            },
            {
              id: `${id}_r`,
              blocks: [
                {
                  id: `${id}_r_t`,
                  type: 'text',
                  props: { text: 'Right column', align: 'left', size: 'sm' },
                },
              ],
            },
          ],
        },
      }
    case 'social':
      return {
        id,
        type,
        props: {
          links: [
            { label: 'X', href: 'https://x.com' },
            { label: 'LinkedIn', href: 'https://linkedin.com' },
          ],
        },
      }
    case 'html':
      return {
        id,
        type,
        props: { html: '<p style="font-size:13px">Custom markup</p>' },
      }
    default:
      return { id, type: 'text', props: { text: '', align: 'left', size: 'md' } }
  }
}

export function EmailEditor({
  document,
  subject,
  preheader,
  onChange,
  onSubjectChange,
  onPreheaderChange,
  readOnly = false,
}: {
  document: EmailDocument
  subject: string
  preheader?: string | null
  onChange: (document: EmailDocument) => void
  onSubjectChange: (subject: string) => void
  onPreheaderChange?: (preheader: string) => void
  readOnly?: boolean
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    document.blocks[0]?.id ?? null,
  )
  const [preview, setPreview] = React.useState<'desktop' | 'mobile' | 'html'>(
    'desktop',
  )
  const [menuOpen, setMenuOpen] = React.useState(false)

  const blocks = document.blocks ?? []

  const updateBlock = (id: string, props: Record<string, unknown>) => {
    onChange({
      blocks: blocks.map((block) =>
        block.id === id ? ({ ...block, props } as EmailBlock) : block,
      ),
    })
  }

  const removeBlock = (id: string) => {
    onChange({ blocks: blocks.filter((block) => block.id !== id) })
    if (selectedId === id) setSelectedId(null)
  }

  const moveBlock = (id: string, direction: -1 | 1) => {
    const index = blocks.findIndex((block) => block.id === id)
    const next = index + direction
    if (index === -1 || next < 0 || next >= blocks.length) return
    const copy = [...blocks]
    const [item] = copy.splice(index, 1)
    copy.splice(next, 0, item!)
    onChange({ blocks: copy })
  }

  const addBlock = (type: EmailBlock['type']) => {
    const block = newBlock(type)
    onChange({ blocks: [...blocks, block] })
    setSelectedId(block.id)
    setMenuOpen(false)
  }

  const insertVariable = (variable: string) => {
    const block = blocks.find((item) => item.id === selectedId)
    if (block && 'text' in block.props) {
      updateBlock(block.id, {
        ...block.props,
        text: `${(block.props.text as string)}${variable}`,
      })
    } else {
      onSubjectChange(`${subject}${variable}`)
    }
  }

  const selected = blocks.find((block) => block.id === selectedId) ?? null

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      {/* ---------------------------------------------------------- compose */}
      <div className="flex min-w-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-4">
          <Field label="Subject line">
            <Input
              value={subject}
              onChange={(event) => onSubjectChange(event.target.value)}
              placeholder="A subject people will actually open"
              readOnly={readOnly}
            />
          </Field>
          {onPreheaderChange ? (
            <Field
              label="Preheader"
              hint="Shown in the inbox list next to the subject"
            >
              <Input
                value={preheader ?? ''}
                onChange={(event) => onPreheaderChange(event.target.value)}
                readOnly={readOnly}
              />
            </Field>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {blocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
              <p className="text-[13px] font-medium">This email is empty</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Add a block to start writing. Type <code className="font-mono">/</code>{' '}
                in the toolbar below for the full palette.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {blocks.map((block, index) => (
                <div
                  key={block.id}
                  onClick={() => setSelectedId(block.id)}
                  className={cn(
                    'group relative rounded-md border p-3 transition-colors duration-100',
                    selectedId === block.id
                      ? 'border-primary bg-accent/40'
                      : 'border-border bg-card hover:border-border-strong',
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      {block.type}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move up"
                        disabled={index === 0 || readOnly}
                        onClick={(event) => {
                          event.stopPropagation()
                          moveBlock(block.id, -1)
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move down"
                        disabled={index === blocks.length - 1 || readOnly}
                        onClick={(event) => {
                          event.stopPropagation()
                          moveBlock(block.id, 1)
                        }}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete block"
                        disabled={readOnly}
                        onClick={(event) => {
                          event.stopPropagation()
                          removeBlock(block.id)
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  {block.type === 'heading' ? (
                    <div className="space-y-2">
                      <Input
                        value={block.props.text}
                        onChange={(event) =>
                          updateBlock(block.id, { text: event.target.value })
                        }
                        className="h-9 font-semibold"
                        readOnly={readOnly}
                      />
                      <div className="flex gap-2">
                        <Select
                          value={String(block.props.level)}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              level: Number(event.target.value),
                            })
                          }
                          className="h-7 w-24 text-[11px]"
                        >
                          <option value="1">H1</option>
                          <option value="2">H2</option>
                          <option value="3">H3</option>
                        </Select>
                        <Select
                          value={block.props.align}
                          onChange={(event) =>
                            updateBlock(block.id, { align: event.target.value })
                          }
                          className="h-7 w-28 text-[11px]"
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  {block.type === 'text' ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={3}
                        value={block.props.text}
                        onChange={(event) =>
                          updateBlock(block.id, { text: event.target.value })
                        }
                        readOnly={readOnly}
                      />
                      <div className="flex gap-2">
                        <Select
                          value={block.props.size}
                          onChange={(event) =>
                            updateBlock(block.id, { size: event.target.value })
                          }
                          className="h-7 w-24 text-[11px]"
                        >
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                        </Select>
                        <Select
                          value={block.props.align}
                          onChange={(event) =>
                            updateBlock(block.id, { align: event.target.value })
                          }
                          className="h-7 w-28 text-[11px]"
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  {block.type === 'image' ? (
                    <div className="space-y-2">
                      <Input
                        value={block.props.src}
                        onChange={(event) =>
                          updateBlock(block.id, { src: event.target.value })
                        }
                        placeholder="https://…"
                        readOnly={readOnly}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={block.props.alt}
                          onChange={(event) =>
                            updateBlock(block.id, { alt: event.target.value })
                          }
                          placeholder="Alt text"
                          readOnly={readOnly}
                        />
                        <Input
                          value={block.props.href}
                          onChange={(event) =>
                            updateBlock(block.id, { href: event.target.value })
                          }
                          placeholder="Link (optional)"
                          readOnly={readOnly}
                        />
                      </div>
                    </div>
                  ) : null}

                  {block.type === 'button' ? (
                    <div className="space-y-2">
                      <Input
                        value={block.props.label}
                        onChange={(event) =>
                          updateBlock(block.id, { label: event.target.value })
                        }
                        readOnly={readOnly}
                      />
                      <Input
                        value={block.props.href}
                        onChange={(event) =>
                          updateBlock(block.id, { href: event.target.value })
                        }
                        placeholder="https://…"
                        readOnly={readOnly}
                      />
                      <div className="flex gap-2">
                        <Select
                          value={block.props.variant}
                          onChange={(event) =>
                            updateBlock(block.id, { variant: event.target.value })
                          }
                          className="h-7 w-28 text-[11px]"
                        >
                          <option value="primary">Primary</option>
                          <option value="outline">Outline</option>
                          <option value="ghost">Ghost</option>
                        </Select>
                        <Select
                          value={block.props.align}
                          onChange={(event) =>
                            updateBlock(block.id, { align: event.target.value })
                          }
                          className="h-7 w-28 text-[11px]"
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  {block.type === 'spacer' ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={block.props.height}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            height: Number(event.target.value),
                          })
                        }
                        className="h-7 w-24"
                        readOnly={readOnly}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        px tall
                      </span>
                    </div>
                  ) : null}

                  {block.type === 'html' ? (
                    <Textarea
                      rows={5}
                      value={block.props.html}
                      onChange={(event) =>
                        updateBlock(block.id, { html: event.target.value })
                      }
                      className="font-mono text-[11px]"
                      readOnly={readOnly}
                    />
                  ) : null}

                  {block.type === 'divider' ? (
                    <div className="py-1">
                      <div className="h-px bg-border" />
                    </div>
                  ) : null}

                  {block.type === 'social' ? (
                    <div className="space-y-2">
                      {block.props.links.map((link, linkIndex) => (
                        <div key={linkIndex} className="grid grid-cols-2 gap-2">
                          <Input
                            value={link.label}
                            onChange={(event) => {
                              const links = [...block.props.links]
                              links[linkIndex] = {
                                ...link,
                                label: event.target.value,
                              }
                              updateBlock(block.id, { links })
                            }}
                            placeholder="Label"
                            readOnly={readOnly}
                          />
                          <Input
                            value={link.href}
                            onChange={(event) => {
                              const links = [...block.props.links]
                              links[linkIndex] = {
                                ...link,
                                href: event.target.value,
                              }
                              updateBlock(block.id, { links })
                            }}
                            placeholder="https://…"
                            readOnly={readOnly}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {block.type === 'columns' ? (
                    <p className="text-[11px] text-muted-foreground">
                      {block.props.columns.length} columns. Each column accepts
                      text, image and button blocks in the rendered preview.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {!readOnly ? (
            <div className="relative mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center border-dashed"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <Plus />
                Add block
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  /
                </span>
              </Button>

              {menuOpen ? (
                <div className="absolute bottom-full left-0 z-20 mb-1 grid w-full grid-cols-3 gap-1 rounded-md border border-border bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]">
                  {BLOCK_MENU.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => addBlock(item.type)}
                        className="flex flex-col items-start gap-1 rounded-sm p-2 text-left transition-colors hover:bg-muted"
                      >
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="text-[12px] font-medium">
                          {item.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {item.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------------------------------------------------------- preview */}
      <div className="flex min-w-0 flex-col bg-subtle">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
            <Button
              variant={preview === 'desktop' ? 'subtle' : 'ghost'}
              size="icon-sm"
              aria-label="Desktop preview"
              onClick={() => setPreview('desktop')}
            >
              <Monitor />
            </Button>
            <Button
              variant={preview === 'mobile' ? 'subtle' : 'ghost'}
              size="icon-sm"
              aria-label="Mobile preview"
              onClick={() => setPreview('mobile')}
            >
              <Smartphone />
            </Button>
            <Button
              variant={preview === 'html' ? 'subtle' : 'ghost'}
              size="icon-sm"
              aria-label="HTML preview"
              onClick={() => setPreview('html')}
            >
              <Eye />
            </Button>
          </div>

          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {preview === 'mobile' ? '375 px' : preview === 'html' ? 'source' : '600 px'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {preview === 'html' ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-card p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {renderDocument(document, {
                baseUrl: 'https://app.lumail.example',
                preview: true,
                preheader,
              })}
            </pre>
          ) : (
            <div
              className={cn(
                'mx-auto transition-[max-width] duration-200',
                preview === 'mobile' ? 'max-w-[375px]' : 'max-w-full',
              )}
            >
              <iframe
                title="Email preview"
                srcDoc={renderDocument(document, {
                  baseUrl: 'https://app.lumail.example',
                  preview: true,
                  preheader,
                })}
                sandbox=""
                className="w-full rounded-md border border-border bg-white"
                style={{ height: 640 }}
              />
            </div>
          )}
        </div>

        {selected && !readOnly ? (
          <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Insert variable into {selected.type}:
            </span>
            <div className="flex flex-wrap gap-1">
              {EMAIL_VARIABLES.slice(0, 5).map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  onClick={() => insertVariable(`{{${variable.key}}}`)}
                  className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-primary hover:bg-accent"
                  title={variable.description}
                >
                  {variable.key}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
