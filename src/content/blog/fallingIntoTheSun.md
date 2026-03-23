---
title: "Falling into  the sun"
pubDate: 2013-12-03
category: "Blog"
tags: ["Physics", "Mathematics", "Gravity", "Pi", "Sun", "Earth"]
author: "Nagarajan"
description: "The earth orbits around the sun because it has angular momentum. If we stopped the earth in orbit then let it fall straight towards the sun, then how long (in seconds) would it take to reach the sun? <br /> <div style=\"display: flex; justify-content: center\"><img style=\"width: 600px; border: 2px solid gray; padding: 12px; box-sizing: border-box\" src=\"/images/corot_ill.jpg\" /></div> <br />"
legacySlug: "fallingIntoTheSun"
disqusIdentifier: "falling_into_the_sun"
---
Recently, I came across a gem of a physics problem, which had the awesome combination of being easy to comprehend, yet being surprisingly difficult to solve.

The problem is thus:

*The earth orbits around the sun because it has angular momentum. If we stopped the earth in orbit then let it fall straight towards the sun, then how long would it take to reach the sun in seconds?*

Now, I love physics and maths, and I believed that it would be a simple matter to knock this one off. Hah... was I mistaken.

<span class="img-center-92">
![Alternate text](/images/corot_ill.jpg)
</span>

------
All right... first, I did succeed in finding the answer and it turned out to be worthy of all the trouble. But before I tell you what it is, why don't you join me in the journey that starts from the first principles and leads to this *beautiful* result. If you are impatient, just scroll to the bottom for the answer... but if you can hold on to your horses (and don't mind some mathematics), you might enjoy yourself more.

Ok, lets start.

We want to find out the time taken by an object, $m_e$ ( the earth ), to fall towards a much heavier object, $M_s$ ( the sun ), purely under the force of gravity, given that $m_e$ starts to fall at time $t = 0$ from a stationary position a certain distance $(d = 150 \times 10^9 m)$ away. Let us assume that the earth and the sun lie on the $x$ axis and at time $t=0$, let the earth be located at at $x=0$ and the sun at $x=d$.

We know from Newton's Law of Gravitation that the force between the earth and the sun is given by

$$F = \frac{G M_s m_e}{r^2}$$

where

*   $F$ : force in newtons ($\text{kg}\text{ m}\text{ s}^{-2}$)
*   $G$ : gravitational constant : $6.67384 \times 10^{-11}\text{ kg}^{-1}\text{m}^3\text{s}^{-2}$
*   $M_s$ : mass of the sun : $1.989 \times 10^{30}\text{ kg}$
*   $m_e$ : mass of the earth : $5.972 \times 10^{24}\text{ kg}$
*   $r$ : distance between earth and sun in meters (changes as earth falls).
*   at $t=0$, $r = d = 1.496 \times 10^{11}\text{ m}$

Also, let $x$ be the position of the earth on the $x\text{-axis}$, such that, at any given time, $(d-x)$ is the distance between the earth and the sun. Now, we try to solve this equation to find the time...

$$F = m_ea = \frac{GM_sm_e}{(d-x)^2}$$

$$\implies a = \frac{GM_s}{(d-x)^2}$$

Now, we also know that

$$a = \frac{dv}{dt} = \frac{d^2x}{dt^2}$$

and we can write

$$\frac{dv}{dt} = \frac{dv}{dx} \times \frac{dx}{dt} = \frac{dv}{dx} \times v$$

The $\frac{dv}{dt} = v \frac{dv}{dx}$ was one of the *key* steps which enables us to separate the variables and solve the differential equation. Now,

$$v \frac{dv}{dx} = \frac{GM_s}{(d-x)^2}$$

Separating the variables (moving dx to the right side) and integrating, we get

$$\int v\, dv = \int \frac{GM_s}{(d-x)^2} dx$$

Performing the integration, we get

$$\frac{v^2}{2} = \frac{GM_s}{(d-x)} + C$$

where $C$ is the constant of integration. We find $C$ by using the known condition that $v = 0$ at $x = 0$,

$$ \implies C = \frac{-GM_s}{d}$$


Putting this value of $C$ in the equation for $v$,

$$\frac{v^2}{2} = \frac{GM_s}{(d-x)} - \frac{GM_s}{d}$$

If you look closely, you might notice that the above equation is the *law of conservation of gravitational potential and kinetic energy*. Woohoo... we just derived a conservation law from first principles (Aside : this *intermediate* result probably keeps popping up in astronomical problems all the time, and was made into a law of it own. I could have used this law right in the beginning to find the velocity at any distance from the sun, but then, I would not have derived the conservation law by myself).  Ok... back to the problem.

$$v = \sqrt{2GM_s \left( \frac{1}{(d-x)} - \frac{1}{d} \right) }$$

$$\frac{dx}{dt} = \sqrt{\frac{2GM_s}{d} . \frac{x}{(d-x)}}$$

Moving $dt$ to the right and variables involving $x$ to the left and integrating, we get

$$\int_0^d \sqrt{\frac{d- x}{x}} dx = \int_0^T \sqrt{\frac{2GM_s}{d}} dt $$

This is where I hit another roadblock. The integral on the left side looked harmless enough, but was surprisingly difficult to solve (as we know well enough about integrals... if someone is getting too cocky about their mathematical abilities, give them a random integral, or a partial differential equation to solve). I finally took the help of Wolfram|Alpha to find the indefinite integral of the left side, and was pleasantly surprised that the function did exist (I differentiated it to make sure that it really was the right answer, and you should try it too. Just like in the spy movies... trust no one. In this case, not even yourself... so check your answer twice, and get it peer reviewed). We now have the following:

$$\left. \sqrt{x(d-x)} - \frac{d}{2} tan^{-1} \left( \frac{(d-2x)} {2 \sqrt{x(d - x)}} \right) \right\vert_0^d = \sqrt{\frac{2GM_s}{d}} T$$


At both $x=0$ and $x=d$, the term inside the $tan^{-1}()$ parentheses contains a division by zero. Usually, that is disastrous for a solution. However, in this case, its not too bad as $tan^{-1}(\pm \infty)$ is well defined. And to know whether the division by zero leads to a $+\infty$ or a $-\infty$, we need to evaluate the LHS at $x=0^+$ and $x=d^-$:

$$\left. \sqrt{x(d-x)} - \frac{d}{2} tan^{-1} \left( \frac{(d-2x)} {2 \sqrt{x(d - x)}} \right) \right\vert_{0^+}^{d^-}$$

The term $\sqrt{x(d-x)}$ equals $0^+$at both $x=0^+$ and $x=d^-$

$$\therefore LHS = -\frac{d}{2} tan^{-1}(-\infty) + \frac{d}{2} tan^{-1}(+\infty) $$
$$= -\frac{d}{2}(-\frac{\pi}{2}) + \frac{d}{2}(+\frac{\pi}{2})$$
$$= \pi \frac{d}{2}$$

Putting the LHS and RHS together, we get
$$\pi \frac{d}{2} = \sqrt{\frac{2GM_s}{d}} T$$

Rearranging the variables around, we finally get

<div class="noteworthy-equation">
  $$T = \pi \frac{d^{3/2}}{\sqrt{8GM_s}}$$
</div>

As often happens in interesting problems, we have journeyed from a simple equation (newton's law) to terrible looking intermediate results, divisions by zero, and challenging integrals... which all finally canceled out to give a simple answer.

**Wait... there is a $\pi$ in the answer!!** How in the frigging cosmos did $\pi$ make its way into the answer. Well, we can go back and look at where it exactly came in... through the $tan^{-1}(+\infty)$ and $tan^{-1}(-\infty)$, which basically means that it popped out from a couple of singularities. It might also have something to do with the periodic oscillation that the earth might have experienced were it not going to be evaporated on contact with the sun. This is as close to magic as we get in mathematics, and yet another beautiful example of unexpected places where $\pi$ shows up.

Now that we have done all the hard work of finding the general solution, its time to put in the values to get the figure of...

$$T = 5578237\text{ seconds} = 64.5629\text{ days}$$

or about 2.1 months.

-------

All this is excellent but I also love programming. Its time to test this analytical solution with a numerical calculation.

I wrote a small python program to calculate the time by simulating the acceleration, velocity and position of the earth as it falls towards the sun. I have also plotted a graph denoting the distance of earth from the sun *vs* time.

------

```python
%matplotlib inline

# calculate time for earth to fall into sun...
from math import sqrt
from time import time

# physical constants/values
G = 6.67384e-11 # gravitational constant
MS = 1.98855e30 # mass of sun
esd = 149597870700.0 # earth-sun distance in meters

# program variables
n = 1000000
myconst1 = (G*MS*n*n)/(esd*esd)
myconst2 = esd/n

def getA(k):
    """ acceleration at distance (esd*k/n) from sun"""
    ak = myconst1/pow(n-k,2)
    return ak

def getV(v, a, t):
    """ velocity at distance (esd*k/n) from sun"""
    vk = v + a*t
    return vk

def getVAT(k, vold, aold, told):
    """ time to get from position (esd*k/n) to (esd*(k+1)/n)"""
    vk = getV(vold, aold, told)
    ak = getA(k)

    tk = (sqrt(vk*vk + 2*ak*myconst2) - vk)/ak
    return vk, ak, tk

stime = time()
sts, v, a, t = 0, 0, 0, 0
plotValues = []
for x in range(n):
    v, a, t = getVAT(x, v, a, t)
    sts += t
    if x % 5000 == 0:
        plotValues.append((sts, n - x))
plotValues.append((sts, n-x-1))

print "Travel time = %.2f seconds\nDays = %5.3f"%(sts, sts/(60.0*60*24))
print "Computation time = %5.4f seconds"%(time() - stime)

```

```
Travel time = 5578753.47 seconds
Days = 64.569
Computation time = 1.8074 seconds
```

Here's the plot of earth's approach towards the sun...

```python
import matplotlib.pyplot as plt
xvals = [sts for sts, x in plotValues]
yvals = [149.597870*x for sts, x in plotValues]
plt.xlabel("Travel time (seconds)")
plt.ylabel("Distance between earth / sun (km)")
plt.plot(xvals, yvals)
```

![Plot of earth's path](/images/earthpathplot.png)
