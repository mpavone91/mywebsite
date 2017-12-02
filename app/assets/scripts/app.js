import MobileMenu from './modules/mobilemenu';
import Revealonscroll from './modules/revealonscroll';
import $ from 'jquery';
import StickyHeader from './modules/StickyHeader';
import Modal from './modules/Modal';

var mobileMenu = new MobileMenu();
new Revealonscroll($(".feature-item"), "85%");
new Revealonscroll($(".testimonial"), "75%");
var stickyHeader = new StickyHeader();
var modal = new Modal();
