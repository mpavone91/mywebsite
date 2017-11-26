function Person(fullName, favColor) {
  this.name = fullName;
  this.color = favColor;
  this.greet = function(){
    console.log("Hello, my name is " + this.name + ", and my favorite color is " + this.color + ".");
  }
}

module.exports = Person;
