// Segmented controls (the tab strip's groove, the settings page's button groups) show the
// selected item as one pill that slides to whichever item gets selected, as shadcn's TabsList.
// Containers are found as pages render them, so knockout templates need nothing extra.
;(() => {
  const CONTROLS = [
    { container: '.tab-groove', selected: '.tab-container.tab-active' },
    { container: '.btn-group', selected: '.btn-primary' },
  ]

  function place(container, selected, follow) {
    const pill = container.querySelector(':scope > .segment-pill')
    const item = container.querySelector(selected)
    // nothing selected, or the selected item is hidden (the settings tab)
    if (!item?.offsetParent) {
      pill.style.opacity = '0'
      return
    }
    // appear in place rather than sliding in from wherever it was last shown, and stay
    // under an item being dragged instead of trailing behind it
    const instant =
      follow || pill.style.opacity !== '1' || item.classList.contains('segment-dragging')
    pill.style.transition = instant ? 'none' : ''
    pill.style.width = `${item.offsetWidth}px`
    pill.style.height = `${item.offsetHeight}px`
    pill.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`
    pill.style.opacity = '1'
  }

  // Tracked here, not marked in the DOM: knockout's `if` copies the markup it first saw, so a
  // marked container (pill included) can come back as a copy nothing here is watching
  const attached = new WeakSet()

  function attach(container, selected) {
    attached.add(container)
    if (!container.querySelector(':scope > .segment-pill')) {
      const pill = document.createElement('div')
      pill.className = 'segment-pill'
      container.prepend(pill)
    }
    const update = () => requestAnimationFrame(() => place(container, selected))
    // items resize with the window, their labels and their own transitions; the pill follows
    // a size change as it happens instead of easing after it. Only an element still in the page
    // whose size differs from the last one seen counts: knockout re-creates tabs on every switch,
    // and the observer reports a new element's size and a removed one's 0x0 as well
    const sizes = new WeakMap()
    const resizes = new ResizeObserver((entries) => {
      let resized = false
      for (const { target, contentRect } of entries) {
        if (!target.isConnected) {
          resizes.unobserve(target)
          continue
        }
        const size = `${contentRect.width}x${contentRect.height}`
        if (sizes.has(target) && sizes.get(target) !== size) resized = true
        sizes.set(target, size)
      }
      if (resized) requestAnimationFrame(() => place(container, selected, true))
    })
    // the container, its children and theirs: the tab strip's items sit in a list inside it
    // (not the pill: its own animated resizing would make it jump to the end)
    const observeItems = () =>
      [container, ...[...container.children].flatMap((el) => [el, ...el.children])]
        .filter((el) => !el.classList.contains('segment-pill'))
        .forEach((el) => resizes.observe(el))
    // style too, for an item dragged by its `left`; the pill's own restyling is ignored
    const pill = container.querySelector(':scope > .segment-pill')
    new MutationObserver((records) => {
      if (records.every((r) => r.target === pill)) return
      observeItems()
      update()
    }).observe(container, { subtree: true, childList: true, attributeFilter: ['class', 'style'] })
    observeItems()
    update()
  }

  function scan() {
    for (const { container, selected } of CONTROLS)
      for (const el of document.querySelectorAll(container))
        if (!attached.has(el)) attach(el, selected)
  }

  new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true })
  scan()
})()
