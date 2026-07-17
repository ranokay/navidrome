import React from 'react'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MobileKaraokeLyricsPortal, {
  MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS,
  MOBILE_KARAOKE_LYRICS_ENTERED_CLASS,
  MOBILE_KARAOKE_LYRICS_HOST_SELECTOR,
  MOBILE_KARAOKE_LYRICS_LAYER_CLASS,
  MOBILE_KARAOKE_LYRICS_TRANSITION_MS,
} from './MobileKaraokeLyricsPortal'

const createHost = () => {
  const host = document.createElement('div')
  host.className = MOBILE_KARAOKE_LYRICS_HOST_SELECTOR.slice(1)
  document.body.appendChild(host)
  return host
}

const portal = (text, active = true) => (
  <MobileKaraokeLyricsPortal active={active}>
    <span>{text}</span>
  </MobileKaraokeLyricsPortal>
)

describe('<MobileKaraokeLyricsPortal />', () => {
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    document.body.innerHTML = ''
  })

  it('mounts active lyrics into the mobile cover host and cleans up the class', () => {
    vi.useFakeTimers()
    const host = createHost()
    const { rerender } = render(portal('Inline lyrics'))

    expect(within(host).getByText('Inline lyrics')).toBeInTheDocument()
    expect(host).toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
    expect(host).toHaveClass(MOBILE_KARAOKE_LYRICS_ENTERED_CLASS)
    expect(
      host.querySelector(`.${MOBILE_KARAOKE_LYRICS_LAYER_CLASS}`),
    ).toHaveAttribute('data-entered', 'true')

    rerender(portal('Inline lyrics', false))

    expect(within(host).getByText('Inline lyrics')).toBeInTheDocument()
    expect(host).toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
    expect(host).not.toHaveClass(MOBILE_KARAOKE_LYRICS_ENTERED_CLASS)
    expect(
      host.querySelector(`.${MOBILE_KARAOKE_LYRICS_LAYER_CLASS}`),
    ).toHaveAttribute('data-entered', 'false')

    act(() => {
      vi.advanceTimersByTime(MOBILE_KARAOKE_LYRICS_TRANSITION_MS)
    })

    expect(screen.queryByText('Inline lyrics')).not.toBeInTheDocument()
    expect(host).not.toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
    expect(host).not.toHaveClass(MOBILE_KARAOKE_LYRICS_ENTERED_CLASS)
  })

  it('attaches when the mobile cover host appears after activation', async () => {
    vi.useFakeTimers()

    render(portal('Late lyrics'))

    expect(screen.queryByText('Late lyrics')).not.toBeInTheDocument()

    const host = createHost()

    await waitFor(() =>
      expect(within(host).getByText('Late lyrics')).toBeInTheDocument(),
    )
    expect(host).toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
  })

  it('moves active lyrics when the mobile cover host is replaced', async () => {
    const firstHost = createHost()

    render(portal('Persistent lyrics'))
    expect(within(firstHost).getByText('Persistent lyrics')).toBeInTheDocument()

    const secondHost = createHost()
    firstHost.replaceWith(secondHost)

    await waitFor(() =>
      expect(
        within(secondHost).getByText('Persistent lyrics'),
      ).toBeInTheDocument(),
    )
    expect(firstHost).not.toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
    expect(secondHost).toHaveClass(MOBILE_KARAOKE_LYRICS_ACTIVE_CLASS)
  })
})
