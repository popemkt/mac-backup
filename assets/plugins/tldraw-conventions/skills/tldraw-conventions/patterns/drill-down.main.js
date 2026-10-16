// Drill-down navigation (tldraw-conventions › patterns/drill-down). A shape whose
// meta.drill = { to: pageId, focus?: shapeId } is a locked control: a click opens that page
// and zooms to `focus`, or fits the page. Edit → Unlock All frees the controls.

/** @param {import('../.script-workspace/script-context').MainScriptContext} ctx */
export default function ({ editor, signal }) {
	// Armed on pointer_down, fired on pointer_up: switching page mid-click would let the select
	// tool finish the click on whatever shape sits under the cursor on the new page.
	let armed = null

	function handleEvent(info) {
		if (info?.type !== 'pointer' || info.button !== 0) return
		if (info.name === 'pointer_down') {
			const shape = editor.getShapeAtPoint(editor.inputs.currentPagePoint, { hitInside: true, hitLocked: true })
			const drill = shape?.meta?.drill
			armed = drill && editor.getPage(drill.to) ? drill : null
		} else if (info.name === 'pointer_up' && armed) {
			const drill = armed
			armed = null
			setTimeout(() => navigate(drill), 0)
		}
	}

	function navigate(drill) {
		editor.setCurrentPage(drill.to)
		editor.selectNone()
		const focus = drill.focus && editor.getShape(drill.focus)
		if (focus) editor.zoomToBounds(editor.getShapePageBounds(focus), { inset: 200 })
		else editor.zoomToFit()
	}

	editor.on('event', handleEvent)
	signal.addEventListener('abort', () => editor.off('event', handleEvent))
}
