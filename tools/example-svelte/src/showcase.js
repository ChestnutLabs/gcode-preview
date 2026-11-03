import { mount } from 'svelte';
import Showcase from './Showcase.svelte';
import '../../demo-kit/tokens.css';

mount(Showcase, { target: document.getElementById('app') });
