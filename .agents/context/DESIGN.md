# Existing Settings design

The interface uses the shared stylesheet in ui/public/style.css. Settings is a two-column settings layout with stack containers and the card helper. Use the existing row, main, title, meta, tag, hint, card-foot, and btn sm classes. The current theme, typography, spacing, icons, and responsive layout remain the source of truth. Render dynamic strings with esc and use native buttons for actions. Loading and empty states use skeleton and empty; errors use the existing hint and flash patterns. This addition requires no new colors, imagery, or motion.
