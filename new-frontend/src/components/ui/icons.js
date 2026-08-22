import Logo from '@/assets/svg/logo.svg'
import Mail from '@/assets/svg/mail.svg'
import ChatBubble from '@/assets/svg/chat-bubble.svg'
import User from '@/assets/svg/user.svg'
import ArrowRight from '@/assets/svg/arrow-right.svg'
import ArrowLeft from '@/assets/svg/arrow-left.svg'
import ArrowDown from '@/assets/svg/arrow-down.svg'
import ArrowUp from '@/assets/svg/arrow-up.svg'
import Plus from '@/assets/svg/plus.svg'
import Close from '@/assets/svg/close.svg'
import Magnifier from '@/assets/svg/magnifier.svg'
import PaperPlane from '@/assets/svg/paper-plane.svg'
import Star from '@/assets/svg/star.svg'
import StarFilled from '@/assets/svg/star-filled.svg'
import Check from '@/assets/svg/check.svg'
import Dot from '@/assets/svg/dot.svg'
import SortAsc from '@/assets/svg/sort-asc.svg'
import SortDesc from '@/assets/svg/sort-desc.svg'
import FilePpt from '@/assets/svg/file-ppt.svg'
import FileDoc from '@/assets/svg/file-doc.svg'
import FilePdf from '@/assets/svg/file-pdf.svg'
import FileTxt from '@/assets/svg/file-txt.svg'
import FileMp3 from '@/assets/svg/file-mp3.svg'
import FileMp4 from '@/assets/svg/file-mp4.svg'
import FileUnknown from '@/assets/svg/file-unknown.svg'

/**
 * Site-wide SVG icon registry (single source)
 * - New icon: drop it in src/assets/svg/ -> register here via import -> use via UiIcon name.
 * - Naming = filename (without .svg).
 */
export const iconRegistry = {
  logo: Logo,
  mail: Mail,
  'chat-bubble': ChatBubble,
  user: User,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  plus: Plus,
  close: Close,
  magnifier: Magnifier,
  'paper-plane': PaperPlane,
  star: Star,
  'star-filled': StarFilled,
  check: Check,
  dot: Dot,
  'sort-asc': SortAsc,
  'sort-desc': SortDesc,
  'file-ppt': FilePpt,
  'file-doc': FileDoc,
  'file-pdf': FilePdf,
  'file-txt': FileTxt,
  'file-mp3': FileMp3,
  'file-mp4': FileMp4,
  'file-unknown': FileUnknown,
}
