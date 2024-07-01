import stylus from 'stylus';

import cssStr from "@assets/css/styles.styl" with { type: "text" };

const generatedCss = await (stylus(cssStr, {})
	.set('filename', 'styles.css')
	.set('compress', true)
	.include('src/assets/css/'))
	.render();

export const renderStylus = () => {
    return generatedCss;
};
