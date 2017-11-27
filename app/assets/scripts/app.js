import MobileMenu from './modules/mobilemenu';
import Revealonscroll from './modules/revealonscroll';
import $ from 'jquery';

var mobileMenu = new MobileMenu();
new Revealonscroll($(".feature-item"), "85%");
new Revealonscroll($(".testimonial"), "75%");
new Revealonscroll($(".generic-content-container"), "80%");
