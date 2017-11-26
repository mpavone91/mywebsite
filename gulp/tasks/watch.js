var gulp = require('gulp'),
watch = require('gulp-watch'),
browserSync = require('browser-sync').create();

// watch functions:

gulp.task('watch', function(){

// This code refreshes the HTML web everytime I save (app is the folder html is in)
browserSync.init({
  server: {
    baseDir: "app"
  }
});
// this code watches for any changes in HTML files

watch('./app/index.html', function() {
    browserSync.reload();

  });

// this code watches for any changes in css files

watch('./app/assets/styles/**/*.css', function(){
  gulp.start('cssInject');
});

watch('./app/assets/scripts/**/*.js', function(){
  gulp.start('scriptsRefresh');
})

});

// This code inject CSS to the web everytime I save it

gulp.task('cssInject', ['styles'], function(){
  return gulp.src('./app/tempo/styles/styles.css')
  .pipe(browserSync.stream());
})

gulp.task('scriptsRefresh', ['scripts'], function(){
  browserSync.reload();
});
